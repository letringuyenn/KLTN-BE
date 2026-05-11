const { GoogleGenerativeAI } = require("@google/generative-ai");
const KnowledgeBase = require("../models/KnowledgeBase");

const GEMINI_REQUEST_TIMEOUT_MS = parseInt(
  process.env.GEMINI_REQUEST_TIMEOUT_MS || "60000",
  10,
);

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

function isGeminiQuotaError(error) {
  const message = String(error?.message || "").toLowerCase();
  const responseText = String(
    error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.response?.data ||
      "",
  ).toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  return (
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.response?.status === 429 ||
    code === "resource_exhausted" ||
    code === "quota_exceeded" ||
    message.includes("quota") ||
    message.includes("resource exhausted") ||
    message.includes("rate limit") ||
    responseText.includes("quota") ||
    responseText.includes("resource exhausted") ||
    responseText.includes("rate limit")
  );
}

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
 * @param {Object} context - Workflow context (branchName, prNumber, fileTree)
 * @returns {Promise<Object>} Structured analysis with rootCause, suggestedFixText, and patchFiles
 */
const analyzeLogsWithAI = async (logs, customApiKey, context = {}) => {
  try {
    if (!logs || logs.trim().length === 0) {
      throw new Error("Logs cannot be empty");
    }

    // 1. ÉP BUỘC CHỈ DÙNG KHÓA TRÊN RENDER, CẮT BỎ MỌI KHOẢNG TRẮNG VÀ DẤU NGOẶC KÉP
    let rawKey = process.env.GEMINI_API_KEY;
    
    if (!rawKey) {
        throw new Error("LỖI BACKEND: Không tìm thấy biến GEMINI_API_KEY trên Render.");
    }

    // Làm sạch key: Xóa khoảng trắng 2 đầu và dấu ngoặc kép thừa (nếu có)
    const cleanKey = rawKey.trim().replace(/^"|"$/g, '');

    // 2. IN LOG BẮT QUẢ TANG
    console.log("=========================================");
    console.log("🔥 CHỐT LUỒNG API KEY CUỐI CÙNG:");
    console.log("- Chiều dài khóa sau khi dọn dẹp:", cleanKey.length);
    console.log("- 5 ký tự đầu tiên:", cleanKey.substring(0, 5));
    console.log("=========================================");

    // 3. KHỞI TẠO LOCAL INSTANCE
    const genAI = new GoogleGenerativeAI(cleanKey);
    const tier = context.tier === "PRO" ? "PRO" : "FREE";
    const fileTree = context.fileTree || "File tree not available";
    
    const localModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

THÔNG TIN QUAN TRỌNG: Dưới đây là cấu trúc cây thư mục thực tế của dự án:
--- FILE TREE ---
${fileTree}
--- END FILE TREE ---

GitHub Flow context:
- branchName: ${branchName}
- prNumber: ${prNumber || "none"}
- isFeatureBranch: ${isFeatureBranch ? "yes" : "no"}
- userTier: ${tier}

NGUYÊN TẮC BẮT BUỘC:
1. TUYỆT ĐỐI KHÔNG ĐƯỢC GIẢ ĐỊNH (ASSUME) hay ĐOÁN MÒ tên thư mục (như 'app', 'src', 'source').
2. Nếu lỗi liên quan đến thiếu working-directory, phải nhìn vào FILE TREE để tìm chính xác vị trí của package.json và dùng đúng đường dẫn đó.
3. Nếu thư mục không tìm thấy trong FILE TREE, không thêm vào đề xuất của bạn.
4. Chỉ đề xuất sửa các file thực sự tồn tại trong FILE TREE.

CRITICAL INSTRUCTION: Return ONLY valid JSON. No markdown fences, no commentary, no prose outside JSON.
CRITICAL INSTRUCTION: The JSON must match this exact shape and key names:
{
  "rootCause": "Detailed explanation of the root cause.",
  "fixSuggestion": "Detailed fix instructions based on actual repository structure.",
  "patchFiles": [
    {
      "filePath": "exact/path/from/file/tree",
      "fileContent": "ENTIRE_FILE_CONTENT_WITH_FIX"
    }
  ]
}

CRITICAL INSTRUCTION: \`patchFiles[].fileContent\` MUST be raw, executable code for the full file to be overwritten.
Do NOT include markdown code fences or wraps around the JSON output, or any conversational text.

Workflow Logs:
${logs}`;

    const result = await Promise.race([
      localModel.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Gemini request timed out")),
          GEMINI_REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
    
    let rawText = result.response.text();
    console.log("--- RAW GEMINI RESPONSE ---");
    console.log(rawText);
    console.log("---------------------------");

    // Xóa bỏ markdown code block
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch (parseError) {
      console.error("🔥 LỖI PARSE JSON TỪ GEMINI:", parseError.message);
      console.error("Raw text sau khi clean:", rawText);
      throw parseError; // Throw để block outer catch bắt được
    }

    // Validate response structure
    if (!aiData.rootCause || !aiData.fixSuggestion) {
      throw new Error(`AI response missing required fields. Parsed keys: ${Object.keys(aiData).join(', ')}`);
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
      suggestedFixText: aiData.fixSuggestion,
      severity: aiData.severity || "MEDIUM",
      patchFiles,
    };
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      const quotaError = new Error(
        "Gemini API quota or rate limit exceeded. Please retry later or use a different API key.",
      );
      quotaError.status = 429;
      quotaError.code = "GEMINI_QUOTA_EXCEEDED";
      quotaError.details = error?.response?.data || error?.message || null;

      console.error("Error analyzing logs with AI: Gemini quota exceeded", {
        message: error?.message,
        status: error?.status || error?.statusCode || error?.response?.status,
        responseData: error?.response?.data,
      });

      throw quotaError;
    }

    console.error("🔥 LỖI GỌI GEMINI API:");
    console.error("- Message:", error.message);
    console.error("- Stack:", error.stack);
    
    console.warn("⚠ Falling back to heuristic analysis");
    return analyzeWithHeuristics(logs, context);
  }
};

module.exports = {
  analyzeLogsWithAI,
};
