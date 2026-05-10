const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const { decryptString, isEncryptedString } = require("../utils/crypto");
const { parseGitHubRepo } = require("../utils/logParser");

const GITHUB_API_BASE = "https://api.github.com";

const resolveGitHubAccessToken = (storedToken) => {
  if (!storedToken || typeof storedToken !== "string") {
    throw new Error("Missing GitHub access token");
  }

  if (isEncryptedString(storedToken)) {
    return decryptString(storedToken);
  }

  // Backward compatibility for records created before encryption rollout.
  return storedToken;
};

const GITHUB_HEADERS = (accessToken) => ({
  Authorization: `token ${accessToken}`,
  Accept: "application/vnd.github.v3+json",
});

const getOctokit = (accessToken) =>
  new Octokit({
    auth: accessToken,
  });

const mapOctokitError = (error) => {
  const status =
    error.response?.status || error.status || error.statusCode || 500;
  const githubMessage =
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    "Unknown GitHub API error";

  const wrappedError = new Error(
    `GitHub API error (${status}): ${githubMessage}`,
  );
  wrappedError.status = status;
  wrappedError.statusCode = status;
  wrappedError.details = {
    status,
    message: githubMessage,
    response: error.response?.data,
  };

  if (status === 401) {
    wrappedError.code = "GITHUB_BAD_CREDENTIALS";
  } else if (status === 404) {
    wrappedError.code = "GITHUB_NOT_FOUND";
  } else if (status === 409) {
    wrappedError.code = "GITHUB_CONFLICT";
  }

  return wrappedError;
};

const resolveBaseBranch = async (octokit, owner, repo, baseBranch) => {
  if (typeof baseBranch === "string" && baseBranch.trim().length > 0) {
    return baseBranch.trim();
  }

  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  if (!data?.default_branch) {
    throw new Error("Unable to resolve repository default branch");
  }

  return data.default_branch;
};

const resolveRunId = async (owner, repo, runId, accessToken) => {
  if (runId && runId !== "latest") {
    return String(runId);
  }

  const runsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?status=completed&per_page=20`;
  const runsResponse = await axios.get(runsUrl, {
    headers: GITHUB_HEADERS(accessToken),
  });

  const runs = runsResponse.data?.workflow_runs || [];
  if (runs.length === 0) {
    throw new Error("No completed workflow runs found for this repository");
  }

  const failedRun = runs.find((run) => run.conclusion === "failure");
  const selectedRun = failedRun || runs[0];

  return String(selectedRun.id);
};

/**
 * Fetch failed workflow logs from GitHub Actions
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} runId - Workflow run ID
 * @param {string} accessToken - GitHub personal access token
 * @returns {Promise<Object>} Workflow context + raw logs
 */
const fetchFailedWorkflowLogs = async (owner, repo, runId, accessToken) => {
  try {
    const decryptedToken = resolveGitHubAccessToken(accessToken);
    const effectiveRunId = await resolveRunId(
      owner,
      repo,
      runId,
      decryptedToken,
    );

    // Get workflow run details
    const runUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${effectiveRunId}`;
    const runResponse = await axios.get(runUrl, {
      headers: GITHUB_HEADERS(decryptedToken),
    });

    if (runResponse.data.status !== "completed") {
      throw new Error("Workflow run is still in progress");
    }

    // Get job details
    const jobsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${effectiveRunId}/jobs`;
    const jobsResponse = await axios.get(jobsUrl, {
      headers: GITHUB_HEADERS(decryptedToken),
    });

    // Find failed jobs
    const failedJobs = jobsResponse.data.jobs.filter(
      (job) => job.conclusion === "failure",
    );

    if (!failedJobs || failedJobs.length === 0) {
      const error = new Error(
        "This workflow run doesn't have any failed jobs to fix.",
      );
      error.status = 400;
      error.statusCode = 400;
      throw error;
    }

    const branchName = runResponse.data?.head_branch || "main";
    const firstPullRequest = Array.isArray(runResponse.data?.pull_requests)
      ? runResponse.data.pull_requests[0] || null
      : null;
    const prNumber = firstPullRequest?.number || null;
    let baseBranch = firstPullRequest?.base?.ref || null;

    if (!baseBranch && prNumber) {
      try {
        const pullResponse = await axios.get(
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
          {
            headers: GITHUB_HEADERS(decryptedToken),
          },
        );
        baseBranch = pullResponse.data?.base?.ref || null;
      } catch (pullError) {
        console.warn(
          "Unable to derive base branch from PR details:",
          pullError.message,
        );
      }
    }

    if (!baseBranch && runResponse.data?.repository?.default_branch) {
      baseBranch = runResponse.data.repository.default_branch;
    }

    if (!baseBranch) {
      baseBranch = null;
    }

    // Fetch logs for each failed job
    let combinedLogs = "";
    for (const job of failedJobs) {
      const logsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`;
      const logsResponse = await axios.get(logsUrl, {
        headers: {
          Authorization: `token ${decryptedToken}`,
          Accept: "application/vnd.github.v3.raw",
        },
      });
      combinedLogs += `\n\n=== Job: ${job.name} ===\n${logsResponse.data}`;
    }

    console.log(`✅ Fetched logs for workflow run ${effectiveRunId}`);
    return {
      logs: combinedLogs,
      effectiveRunId,
      branchName,
      baseBranch,
      prNumber,
    };
  } catch (error) {
    const githubMessage =
      error.response?.data?.message || error.response?.data?.error;
    const details = githubMessage ? ` (${githubMessage})` : "";
    console.error("Error fetching GitHub logs:", error.message, details);
    const wrappedError = new Error(
      `Failed to fetch workflow logs: ${error.message}${details}`,
    );
    wrappedError.status = error.status || error.statusCode || 500;
    wrappedError.statusCode = wrappedError.status;
    throw wrappedError;
  }
};

/**
 * Create a fix branch and commit an array of patch files using Octokit.
 * @param {string} userToken
 * @param {string} owner
 * @param {string} repo
 * @param {string | null} baseBranch
 * @param {Array<{filePath:string,fileContent:string}>} patchFiles
 * @param {string} branchName
 * @param {string} commitMessage
 */
const createFixBranchAndCommit = async (
  userToken,
  owner,
  repo,
  baseBranch = null,
  patchFiles = [],
  branchName,
  commitMessage = "chore: apply AI suggested fixes",
) => {
  try {
    if (!Array.isArray(patchFiles) || patchFiles.length === 0) {
      throw new Error("patchFiles must be a non-empty array");
    }

    const decryptedToken = resolveGitHubAccessToken(userToken);
    const octokit = getOctokit(decryptedToken);
    const resolvedBaseBranch = await resolveBaseBranch(
      octokit,
      owner,
      repo,
      baseBranch,
    );

    const {
      data: {
        object: { sha: baseSha },
      },
    } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${resolvedBaseBranch}`,
    });

    const effectiveBranchName = branchName || `autofix-${Date.now()}`;

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${effectiveBranchName}`,
      sha: baseSha,
    });

    for (let i = 0; i < patchFiles.length; i += 1) {
      const patch = patchFiles[i];
      const filePath = patch.filePath;
      const fileContent = patch.fileContent;

      let sha;
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: effectiveBranchName,
        });

        if (!Array.isArray(data) && data && data.sha) {
          sha = data.sha;
        }
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `${commitMessage} (${i + 1}/${patchFiles.length})`,
        content: Buffer.from(fileContent, "utf8").toString("base64"),
        branch: effectiveBranchName,
        ...(sha ? { sha } : {}),
      });
    }

    console.log(
      `✅ Applied ${patchFiles.length} patch file(s) on branch ${effectiveBranchName}`,
    );

    const newBranchName = effectiveBranchName;
    const prUrl = `https://github.com/${owner}/${repo}/compare/${resolvedBaseBranch}...${newBranchName}?expand=1`;

    return {
      branchName: newBranchName,
      baseBranch: resolvedBaseBranch,
      filesCommitted: patchFiles.length,
      prUrl,
    };
  } catch (error) {
    console.error(
      "Error creating fix branch and committing patch files:",
      error.message,
    );
    throw mapOctokitError(error);
  }
};

/**
 * Create a Pull Request
 * @param {object} params - PR creation parameters
 * @param {string} params.repoUrl - GitHub repository URL or owner/repo
 * @param {string | null} params.baseBranch - Target branch
 * @param {string} params.newBranch - Head branch with changes
 * @param {Array<{filePath:string,fileContent:string}>} params.files - Patch files to commit before PR creation
 * @param {string} params.githubToken - GitHub personal access token
 * @param {string} params.title - PR title
 * @param {string} params.body - PR description
 * @returns {Promise<Object>} PR creation response
 */
const createPullRequest = async ({
  repoUrl,
  baseBranch = null,
  newBranch,
  files = [],
  githubToken,
  title,
  body,
}) => {
  try {
    const parsedRepo = parseGitHubRepo(repoUrl);
    if (!parsedRepo) {
      throw new Error("Invalid repository format");
    }

    const { owner, repo } = parsedRepo;
    const decryptedToken = resolveGitHubAccessToken(githubToken);
    const octokit = getOctokit(decryptedToken);
    const resolvedBaseBranch = await resolveBaseBranch(
      octokit,
      owner,
      repo,
      baseBranch,
    );

    const branchName =
      typeof newBranch === "string" && newBranch.trim().length > 0
        ? newBranch.trim()
        : `autofix-${Date.now()}`;

    let committedBranch = branchName;

    if (Array.isArray(files) && files.length > 0) {
      const commitResult = await createFixBranchAndCommit(
        decryptedToken,
        owner,
        repo,
        resolvedBaseBranch,
        files,
        branchName,
        title || "chore: apply AI suggested fixes",
      );

      committedBranch = commitResult.branchName;
    }

    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: committedBranch,
      base: resolvedBaseBranch,
    });

    console.log(`✅ Created PR #${data.number}`);
    return {
      prNumber: data.number,
      prUrl: data.html_url,
      branchName: committedBranch,
      baseBranch: resolvedBaseBranch,
      ...data,
    };
  } catch (error) {
    const wrappedError = mapOctokitError(error);
    console.error(
      "Error creating PR:",
      wrappedError.message,
      wrappedError.details,
    );
    throw wrappedError;
  }
};

module.exports = {
  fetchFailedWorkflowLogs,
  createFixBranchAndCommit,
  createPullRequest,
};
