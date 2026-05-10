const { GoogleGenerativeAI } = require("@google/generative-ai");
const KnowledgeBase = require("../models/KnowledgeBase");

const buildSearchText = (logs, context = {}) => {
  const explicitError =
    typeof context.errorMessage === "string" ? context.errorMessage.trim() : "";

  if (explicitError) {
    return explicitError;
  }

  return String(logs || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join(" ")
    .slice(0, 1200);
};

const fetchKnowledgeContext = async (searchText) => {
  if (!searchText || !searchText.trim()) {
    return "";
  }

  const docs = await KnowledgeBase.find(
    { $text: { $search: searchText } },
    { score: { $meta: "textScore" }, title: 1, content: 1, sourceUrl: 1 },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(2)
    .lean();

  if (!docs.length) {
    return "";
  }

  return docs
    .map(
      (doc, index) =>
        `[Doc ${index + 1}] ${doc.title}\nSource: ${doc.sourceUrl}\n${String(
          doc.content || "",
        ).slice(0, 1500)}`,
    )
    .join("\n\n");
};

function analyzeWithHeuristics(logs, context = {}) {
  const branchName = context.branchName || "main";
  const isFeatureBranch =
    typeof branchName === "string" &&
    branchName !== "main" &&
    !branchName.startsWith("release/");

  const checks = [
    {
      pattern: /module not found|can't resolve/i,
      rootCause:
        "Build failed because one or more imported modules/packages are missing from dependencies.",
      suggestedFix:
        "Install missing packages and ensure import paths are correct. Then run a clean install and rebuild. Example: npm install <missing-package> && npm run build.",
      severity: "HIGH",
    },
    {
      pattern: /enoent|no such file or directory/i,
      rootCause:
        "The workflow references a file/path that does not exist in the runner environment.",
      suggestedFix:
        "Verify working directory and file paths in workflow steps. Add debug steps: pwd and ls -la before failing command.",
      severity: "HIGH",
    },
    {
      pattern: /permission denied|eacces/i,
      rootCause: "The workflow command failed due to insufficient permissions.",
      suggestedFix:
        "Grant required permissions in workflow/job, check token scopes, and add chmod for executable scripts when needed.",
      severity: "HIGH",
    },
    {
      pattern: /timed out|timeout|exceeded/i,
      rootCause: "The workflow exceeded allowed execution time.",
      suggestedFix:
        "Add dependency caching, reduce job scope, split long tasks, and optimize test/build commands to complete within timeout limits.",
      severity: "MEDIUM",
    },
    {
      pattern: /npm err!|yarn error|pnpm err/i,
      rootCause:
        "Dependency installation or script execution failed in package manager step.",
      suggestedFix:
        "Pin Node version, lock package manager version, clear cache, and use deterministic install command (npm ci / pnpm install --frozen-lockfile).",
      severity: "MEDIUM",
    },
    {
      pattern: /test failed|failing tests|assertionerror/i,
      rootCause: "Workflow failed because one or more tests are failing.",
      suggestedFix:
        "Open test output for first failing test, reproduce locally, and fix flaky tests or environment-dependent assertions.",
      severity: "MEDIUM",
    },
  ];

  const matched = checks.find((item) => item.pattern.test(logs));

  if (matched) {
    const featureBranchHint = isFeatureBranch
      ? " Focus on minimal, reviewable changes suitable for GitHub Flow Pull Request review."
      : "";

    return {
      reasoning_trace:
        "Matched known failure signature from heuristic rule-set.",
      rootCause: matched.rootCause,
      suggestedFixText: `${matched.suggestedFix}${featureBranchHint}`,
      severity: matched.severity,
      patchFiles: [],
    };
  }

  return {
    reasoning_trace:
      "No deterministic pattern match found; returning generalized remediation guidance.",
    rootCause:
      "Unable to determine an exact root cause from logs automatically. The failure appears to be workflow/environment related.",
    suggestedFixText: isFeatureBranch
      ? "Inspect the first error stack trace in job logs, apply the smallest safe patch on the feature branch, and prepare a PR-ready fix with clear review notes."
      : "Inspect the first error stack trace in job logs, verify secrets/env vars, pin tool versions, and retry with debug logging enabled.",
    severity: "MEDIUM",
    patchFiles: [],
  };
}

/**
 * Analyze CI/CD logs using Google Gemini AI
 * @param {string} logs - Raw CI/CD workflow logs
 * @param {string} customApiKey - Optional Gemini API key from user request header
 * @param {Object} context - Workflow context (branchName, prNumber)
 * @returns {Promise<Object>} Structured analysis with rootCause, suggestedFixText, and patchFiles
 */
const analyzeLogsWithAI = async (logs, customApiKey, context = {}) => {
  try {
    if (!logs || logs.trim().length === 0) {
      throw new Error("Logs cannot be empty");
    }

    const API_KEY_TO_USE = customApiKey || process.env.GEMINI_API_KEY;

    if (!API_KEY_TO_USE) {
      console.warn("⚠ GEMINI_API_KEY not found, using heuristic fallback");
      return analyzeWithHeuristics(logs, context);
    }

    const client = new GoogleGenerativeAI(API_KEY_TO_USE);
    const tier = context.tier === "PRO" ? "PRO" : "FREE";
    const modelName = "gemini-2.5-flash";

    const model = client.getGenerativeModel({ model: modelName });

    const branchName = context.branchName || "main";
    const prNumber = context.prNumber || null;
    const searchText = buildSearchText(logs, context);
    const verifiedDocsContext = await fetchKnowledgeContext(searchText);
    const isFeatureBranch =
      typeof branchName === "string" &&
      branchName !== "main" &&
      !branchName.startsWith("release/");

    const ragPrefix = verifiedDocsContext
      ? `Use the following verified DevSecOps documentation to formulate your fix:\n${verifiedDocsContext}\n\n`
      : "";

    const prompt = `${ragPrefix}You are an Expert DevSecOps Engineer and CI/CD Pipeline Debugger.
  Analyze the following workflow logs to identify failures and generate a machine-readable patch plan.

  GitHub Flow context:
  - branchName: ${branchName}
  - prNumber: ${prNumber || "none"}
  - isFeatureBranch: ${isFeatureBranch ? "yes" : "no"}
  - userTier: ${tier}

  If isFeatureBranch is yes, prioritize recommendations that are minimal, review-friendly, and safe for Pull Request review before merging to main.

CRITICAL INSTRUCTION: Return ONLY valid JSON. No markdown fences, no commentary, no prose outside JSON.
CRITICAL INSTRUCTION: The JSON must match this exact shape and key names:
{
  "reasoning_trace": "Explanation of the root cause...",
  "rootCause": "Short root cause summary",
  "suggestedFixText": "Human readable instructions for the UI",
  "severity": "HIGH",
  "patchFiles": [
    {
      "filePath": "exact/relative/path/to/file.js",
      "fileContent": "RAW_CODE_HERE"
    }
  ]
}

CRITICAL INSTRUCTION: fileContent MUST be raw, executable code for that file.
Do NOT include markdown code fences, language tags, or inline explanations in fileContent.
Do NOT wrap fileContent in triple backticks.
If no safe patch is known, return patchFiles as an empty array.

Workflow Logs:
${logs}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const aiData = JSON.parse(responseText.replace(/```json\n|```/g, ""));

    // Validate response structure
    if (!aiData.rootCause || !aiData.suggestedFixText) {
      throw new Error("AI response missing required fields");
    }

    const patchFiles = Array.isArray(aiData.patchFiles)
      ? aiData.patchFiles
          .filter(
            (file) =>
              file &&
              typeof file.filePath === "string" &&
              file.filePath.trim().length > 0 &&
              typeof file.fileContent === "string",
          )
          .map((file) => ({
            filePath: file.filePath.trim(),
            fileContent: file.fileContent,
          }))
      : [];

    console.log("✅ AI analysis completed successfully");
    return {
      reasoning_trace: aiData.reasoning_trace || "",
      rootCause: aiData.rootCause,
      suggestedFixText: aiData.suggestedFixText,
      severity: aiData.severity || "MEDIUM",
      patchFiles,
    };
  } catch (error) {
    console.error("Error analyzing logs with AI:", error.message);
    console.warn("⚠ Falling back to heuristic analysis");
    return analyzeWithHeuristics(logs, context);
  }
};

module.exports = {
  analyzeLogsWithAI,
};
