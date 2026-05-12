const AnalysisLog = require("../models/AnalysisLog");
const User = require("../models/User");
const {
  fetchFailedWorkflowLogs,
  createFixBranchAndCommit,
  createPullRequest,
  getRepositoryTree,
} = require("./githubService");
const { analyzeLogsWithAI } = require("./aiService");
const {
  parseGitHubRepo,
  extractRunId,
  extractPrimaryErrorMessage,
  extractTestFailureDetails,
} = require("../utils/logParser");
const { resolveEffectiveApiKey } = require("../utils/apiKeyResolver");

const MAX_RAW_SNIPPET_LENGTH = 15000;
const FREE_ANALYSIS_LIMIT = 5;
const RESET_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function createServiceError(status, message, details, code) {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  if (code) {
    error.code = code;
  }
  return error;
}

async function enforceWeeklyLimitForUser(user) {
  if (!user) {
    throw createServiceError(401, "Unauthorized request");
  }

  if (user.role === "ADMIN") {
    if (user.tier !== "PRO") {
      user.tier = "PRO";
      await user.save();
    }
    return;
  }

  if (user.tier === "PRO") {
    return;
  }

  const now = Date.now();
  const lastReset = user.lastResetDate
    ? new Date(user.lastResetDate).getTime()
    : 0;

  if (!lastReset || now - lastReset >= RESET_INTERVAL_MS) {
    user.analyzeCount = 0;
    user.lastResetDate = new Date(now);
    await user.save();
    return;
  }

  if ((user.analyzeCount || 0) >= FREE_ANALYSIS_LIMIT) {
    throw createServiceError(
      403,
      "Free tier weekly analysis limit reached. Upgrade to PRO for unlimited analysis.",
      {
        limit: FREE_ANALYSIS_LIMIT,
        windowDays: 7,
      },
      "LIMIT_EXCEEDED",
    );
  }
}

// parseGitHubRepo, extractRunId, extractPrimaryErrorMessage
// are now imported from ../utils/logParser.js (DRY)

async function analyzeWorkflowForUser({
  repoUrl,
  workflowRunId,
  userId,
  customApiKey,
  githubToken,
}) {
  if (!repoUrl) {
    throw createServiceError(400, "repoUrl is required");
  }

  const parsedRepo = parseGitHubRepo(repoUrl);
  if (!parsedRepo) {
    throw createServiceError(
      400,
      "Invalid repository format. Use either https://github.com/owner/repo or owner/repo",
    );
  }

  const { owner, repo, repoFullName } = parsedRepo;
  const effectiveRunId =
    (workflowRunId && String(workflowRunId).trim()) ||
    extractRunId(repoUrl) ||
    "latest";

  const user = await User.findById(userId);
  if (!user || !user.githubAccessToken) {
    throw createServiceError(
      401,
      "User not authenticated with GitHub or token missing",
    );
  }

  const effectiveGitHubToken =
    typeof githubToken === "string" && githubToken.trim().length > 0
      ? githubToken
      : user.githubAccessToken;

  await enforceWeeklyLimitForUser(user);

  // Validate BYOK authorization before resolving key
  const requestedCustomKey =
    typeof customApiKey === "string" ? customApiKey.trim() : "";
  if (requestedCustomKey) {
    const isByokAuthorized = user.role === "USER" && user.tier === "PRO";
    if (!isByokAuthorized) {
      throw createServiceError(
        403,
        "Custom Gemini key is only available for PRO users",
        {
          role: user.role,
          tier: user.tier,
        },
        "PRO_REQUIRED",
      );
    }
  }

  const effectiveApiKey = resolveEffectiveApiKey(user, customApiKey);

  const analysisStartedAt = Date.now();
  console.log("[Analysis] Job started", {
    userId: String(userId),
    repoUrl,
    workflowRunId: effectiveRunId,
    hasCustomApiKey: Boolean(customApiKey),
    tier: user.tier,
  });

  const analysisLog = new AnalysisLog({
    userId,
    repoFullName,
    runId: String(effectiveRunId),
    rawErrorSnippet: "Collecting workflow logs...",
    aiResult: {
      rootCause: "Analyzing logs...",
      suggestedFix: "Please wait while we generate a fix suggestion...",
    },
    suggestedFixText: null,
    patchFiles: [],
    branchName: "main",
    baseBranch: null,
    status: "PENDING",
  });
  await analysisLog.save();

  try {
    console.log("[Analysis] Fetching GitHub workflow logs...");
    const workflowData = await fetchFailedWorkflowLogs(
      owner,
      repo,
      effectiveRunId,
      effectiveGitHubToken,
    );

    console.log("[Analysis] GitHub workflow logs fetched", {
      elapsedMs: Date.now() - analysisStartedAt,
      runId: workflowData.effectiveRunId,
      branchName: workflowData.branchName,
      prNumber: workflowData.prNumber,
    });

    analysisLog.rawErrorSnippet = (workflowData.logs || "").slice(
      0,
      MAX_RAW_SNIPPET_LENGTH,
    );
    analysisLog.branchName = workflowData.branchName || "main";
    analysisLog.baseBranch = workflowData.baseBranch || null;
    analysisLog.prNumber = workflowData.prNumber || null;

    console.log("[Analysis] Fetching repository file tree for AI context...");
    let fileTreeForAI = "";
    try {
      fileTreeForAI = await getRepositoryTree(
        owner,
        repo,
        workflowData.branchName || "main",
        effectiveGitHubToken,
      );
    } catch (treeError) {
      console.warn("[Analysis] Could not fetch file tree:", treeError.message);
      fileTreeForAI = "File tree unavailable for this analysis.";
    }

    console.log("[Analysis] Calling Gemini analysis with file tree context...");

    // ✅ Extract test failure details for AI analysis
    const testFailures = extractTestFailureDetails(workflowData.logs || "");

    const aiAnalysis = await analyzeLogsWithAI(
      workflowData.logs || "",
      effectiveApiKey,
      {
        branchName: analysisLog.branchName,
        prNumber: analysisLog.prNumber,
        errorMessage: extractPrimaryErrorMessage(workflowData.logs || ""),
        tier: user.tier,
        fileTree: fileTreeForAI,
        testFailureDetails: testFailures, // ✅ Pass test failure details
      },
    );

    console.log("[Analysis] Gemini analysis finished", {
      elapsedMs: Date.now() - analysisStartedAt,
      severity: aiAnalysis.severity,
      hasPatchFiles: Array.isArray(aiAnalysis.patchFiles)
        ? aiAnalysis.patchFiles.length > 0
        : false,
    });

    analysisLog.aiResult = {
      rootCause: aiAnalysis.rootCause,
      suggestedFix: aiAnalysis.suggestedFixText,
    };
    analysisLog.suggestedFixText = aiAnalysis.suggestedFixText;
    analysisLog.patchFiles = aiAnalysis.patchFiles || [];
    analysisLog.reasoning_trace = aiAnalysis.reasoning_trace || null;
    analysisLog.severity = aiAnalysis.severity || "MEDIUM";
    analysisLog.status = "COMPLETED";
    await analysisLog.save();

    console.log("[Analysis] Analysis log saved", {
      elapsedMs: Date.now() - analysisStartedAt,
      analysisLogId: String(analysisLog._id),
    });

    if (user.role !== "ADMIN" && user.tier !== "PRO") {
      user.analyzeCount = (user.analyzeCount || 0) + 1;
      await user.save();
    }

    return analysisLog;
  } catch (error) {
    analysisLog.status = "FAILED";
    analysisLog.errorMessage = error.message;
    await analysisLog.save();

    if (error.status || error.statusCode) {
      if (!error.status && error.statusCode) {
        error.status = error.statusCode;
      }
      throw error;
    }

    throw createServiceError(500, "Workflow analysis failed", error.message);
  }
}

async function getHistoryForRequester({
  requesterId,
  requesterRole,
  page,
  limit,
}) {
  if (!requesterId || !requesterRole) {
    throw createServiceError(401, "Unauthorized request");
  }

  const safePage = parseInt(page, 10) || 1;
  const safeLimit = parseInt(limit, 10) || 10;
  const skip = (safePage - 1) * safeLimit;

  const query = requesterRole === "ADMIN" ? {} : { userId: requesterId };

  let findQuery = AnalysisLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(safeLimit);

  if (requesterRole === "ADMIN") {
    findQuery = findQuery.populate(
      "userId",
      "_id username githubId avatar role",
    );
  }

  const logs = await findQuery.lean();
  const total = await AnalysisLog.countDocuments(query);

  return {
    analyses: logs,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
}

async function createAutoFixPullRequest({ analysisId, userId, githubToken }) {
  if (!analysisId) {
    throw createServiceError(400, "analysisId is required");
  }

  const analysisLog = await AnalysisLog.findById(analysisId);
  if (!analysisLog) {
    throw createServiceError(404, "Analysis log not found");
  }

  if (analysisLog.userId.toString() !== userId) {
    throw createServiceError(
      403,
      "Unauthorized: Analysis does not belong to user",
    );
  }

  if (analysisLog.status !== "COMPLETED") {
    throw createServiceError(
      400,
      "Analysis must be completed before creating PR",
    );
  }

  const patchFiles = Array.isArray(analysisLog.patchFiles)
    ? analysisLog.patchFiles.filter(
        (file) =>
          file &&
          typeof file.filePath === "string" &&
          file.filePath.trim().length > 0 &&
          typeof file.fileContent === "string",
      )
    : [];

  if (patchFiles.length === 0) {
    throw createServiceError(
      400,
      "No patch files available for this analysis. Run analysis again.",
    );
  }

  const user = await User.findById(userId);
  if (!user || !user.githubAccessToken) {
    throw createServiceError(401, "User GitHub token not found");
  }

  const effectiveGitHubToken =
    typeof githubToken === "string" && githubToken.trim().length > 0
      ? githubToken
      : user.githubAccessToken;

  const parsedRepo = parseGitHubRepo(analysisLog.repoFullName);
  if (!parsedRepo) {
    throw createServiceError(400, "Invalid repo URL format");
  }

  const { owner, repo } = parsedRepo;
  const timestamp = Date.now();
  const featureBranchName = `autofix-cicd-${timestamp}`;

  try {
    const rootCause = analysisLog.aiResult?.rootCause || "CI/CD issue";
    const commitMessage = `🤖 Auto-fix: ${rootCause.substring(0, 50)}...`;

    const prResult = await createPullRequest({
      repoUrl: analysisLog.repoFullName,
      baseBranch: analysisLog.baseBranch || null,
      newBranch: featureBranchName,
      files: patchFiles,
      githubToken: effectiveGitHubToken,
      title: `🤖 Auto-fix: ${rootCause.substring(0, 50)}...`,
      body: [
        `This PR was generated from analysis job #${analysisLog._id}.`,
        "",
        `Root cause: ${rootCause}`,
        "",
        "Suggested fix:",
        analysisLog.suggestedFixText ||
          analysisLog.aiResult?.suggestedFix ||
          "N/A",
      ].join("\n"),
    });

    analysisLog.prUrl = prResult.prUrl;
    analysisLog.prNumber = prResult.prNumber || null;
    analysisLog.status = "PR_CREATED";
    await analysisLog.save();

    return {
      message: "Compare URL created successfully",
      prUrl: prResult.prUrl,
      prNumber: prResult.prNumber,
    };
  } catch (error) {
    analysisLog.status = "FAILED";
    analysisLog.errorMessage = `PR creation failed: ${error.message}`;
    await analysisLog.save();

    const status = error.status || error.statusCode || 500;
    const code =
      error.code ||
      (status === 401
        ? "GITHUB_BAD_CREDENTIALS"
        : status === 404
          ? "GITHUB_NOT_FOUND"
          : status === 409
            ? "GITHUB_CONFLICT"
            : undefined);

    throw createServiceError(
      status,
      `Failed to create pull request: ${error.message}`,
      error.details || error.message,
      code,
    );
  }
}

module.exports = {
  analyzeWorkflowForUser,
  getHistoryForRequester,
  createAutoFixPullRequest,
};
