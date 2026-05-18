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

    // 1. SỬ DỤNG CUSTOM KEY (NẾU CÓ) HOẶC RENDER KEY, CẮT BỎ MỌI KHOẢNG TRẮNG VÀ DẤU NGOẶC KÉP
    let rawKey = customApiKey || process.env.GEMINI_API_KEY;

    if (!rawKey) {
      throw new Error(
        "LỖI BACKEND: Không tìm thấy biến GEMINI_API_KEY trên Render và người dùng không cung cấp Custom Key.",
      );
    }

    // Làm sạch key: Xóa khoảng trắng 2 đầu và dấu ngoặc kép thừa (nếu có)
    const cleanKey = rawKey.trim().replace(/^"|"$/g, "");

    console.log("=========================================");
    console.log("🔥 CHỐT LUỒNG API KEY CUỐI CÙNG:");
    console.log("- Chiều dài khóa sau khi dọn dẹp:", cleanKey.length);
    console.log("- 5 ký tự đầu tiên:", cleanKey.substring(0, 5));
    console.log("=========================================");

    // 3. KHỞI TẠO LOCAL INSTANCE
    const genAI = new GoogleGenerativeAI(cleanKey);
    const tier = context.tier === "PRO" ? "PRO" : "FREE";
    const fileTree = context.fileTree || "File tree not available";
    const testFailureDetails = context.testFailureDetails || []; // ✅ New: test failure context

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

    // ✅ Format test failures for AI
    let testFailureContext = "";
    if (Array.isArray(testFailureDetails) && testFailureDetails.length > 0) {
      testFailureContext = "\n\nTEST FAILURES DETECTED:\n";
      testFailureDetails.forEach((failure, idx) => {
        testFailureContext += `\n${idx + 1}. Test: "${failure.testName}" (${failure.type})\n`;
        testFailureContext += `   Message: ${failure.message}\n`;
        if (failure.expected && failure.actual) {
          testFailureContext += `   Expected: ${failure.expected}\n`;
          testFailureContext += `   Actual: ${failure.actual}\n`;
        }
      });
      testFailureContext += "\n--- END TEST FAILURES ---\n";
    }

    const prompt = `${ragPrefix}You are an Expert DevSecOps Engineer and CI/CD Pipeline Debugger.
Analyze the following workflow logs to identify failures and generate a machine-readable patch plan.

THÔNG TIN QUAN TRỌNG: Dưới đây là cấu trúc cây thư mục thực tế của dự án:
--- FILE TREE ---
${fileTree}
--- END FILE TREE ---
${testFailureContext}
GitHub Flow context:
- branchName: ${branchName}
- prNumber: ${prNumber || "none"}
- isFeatureBranch: ${isFeatureBranch ? "yes" : "no"}
- userTier: ${tier}

PHẠM VI PHÂN TÍCH VÀ SỬA CHỮA:
Bạn CÓ THỂ gặp các loại lỗi sau đây, và cần phân tích + đề xuất sửa:

1. **SYNTAX & RUNTIME ERRORS:**
   - Missing dependencies (npm, pip, gems, etc.)
   - Import/Module errors (cannot find module)
   - Syntax errors (SyntaxError, parse error)
   - Permission denied (EACCES)
   - File not found (ENOENT)
   - Action: Fix imports, install packages, check paths

2. **BUILD ERRORS:**
   - Compilation failures (TypeScript, Java, Go, etc.)
   - Build tool errors (webpack, gradle, maven)
   - Missing build config (tsconfig.json, build.gradle)
   - Action: Fix source code, check compiler config, update buildpaths

3. **TEST FAILURES & LOGIC ERRORS:**
   - Test assertions fail (expected vs actual mismatch)
   - Logic bugs (wrong calculation, wrong condition)
   - Algorithm errors (incorrect sorting, filtering)
   - Business logic issues (wrong discount calculation, wrong state)
   - Action: Analyze test failure details, fix source code logic, NOT the tests

4. **CONFIGURATION & ENVIRONMENT:**
   - Missing environment variables
   - Wrong working directory
   - Missing GitHub Actions secrets
   - Incorrect workflow config (.yml file)
   - Action: Add env vars, fix config files, update workflow steps

5. **RESOURCE & TIMEOUT ISSUES:**
   - Memory exceeded
   - Process timeout
   - Disk space full
   - Action: Optimize code, increase timeout, reduce data processing

6. **NETWORK & API ERRORS:**
   - Connection refused / timeout
   - Authentication failed
   - Invalid credentials (tokens, API keys)
   - Action: Check credentials, verify endpoints, add retries

PHÂN TÍCH CHI TIẾT:
- Tập trung MẠNH MẼ vào nguyên nhân gốc rễ (Root Cause) của lỗi. Root Cause cần phải ngắn gọn, súc tích, đi thẳng vào vấn đề chính, hạn chế các từ ngữ rườm rà.
- Đọc và hiểu TẬT CẢ test failure details để xác định CHÍNH XÁC logic sai ở đâu.
- Không chỉ nói "test failed", mà phải nói "test failed vì hàm X tính sai giá trị Y".
- Nếu có "Expected vs Actual", hãy suy luận tại sao logic sai.
- Xem xét toàn bộ hệ thống, không chỉ fix cái "sáng nhất".

NGUYÊN TẮC KHI ĐỀ XUẤT:
1. Chỉ sửa file tồn tại trong FILE TREE
2. Không giả định cấu trúc nếu chưa thấy
3. Cân nhắc impact toàn project (không sửa nước này mà hỏng nước khác)
4. Nếu cần file mới, đặt vào folder hợp lệ
5. Giải thích CHI TIẾT tại sao cách sửa đó hoạt động

Your response MUST strictly adhere to this exact JSON format:
{
  "reasoning_trace": "A brief internal explanation of how you identified the error (chain of thought). Keep it under 2 sentences.",
  "rootCause": "A concise, direct statement of the core issue. Max length 2-3 sentences. Do not use filler text.",
  "suggestedFixText": "Actionable, clear guidance on how to fix.",
  "severity": "LOW, MEDIUM, HIGH, or CRITICAL",
  "patchFiles": [
    {
      "filePath": "string (MUST EXIST in the FILE TREE)",
      "patchContent": "string (Full updated file content or unified diff)"
    }
  ]
}

CRITICAL INSTRUCTION: Return ONLY valid JSON. No markdown fences, no commentary, no prose outside JSON.
CRITICAL INSTRUCTION: The JSON must match this exact shape and key names:
{
  "rootCause": "Detailed explanation of ROOT CAUSE (specific: missing dependency, wrong logic in function X, missing env var Y, etc.)",
  "fixSuggestion": "Detailed fix instructions: 1) file to modify, 2) what to change, 3) why this fixes the issue",
  "patchFiles": [
    {
      "filePath": "exact/path/from/file/tree",
      "fileContent": "ENTIRE_FILE_CONTENT_WITH_FIX"
    }
  ]
}

CRITICAL INSTRUCTION: Always provide patchFiles array. If no files to fix, use empty array [].
CRITICAL INSTRUCTION: \`patchFiles[].fileContent\` MUST be raw, executable code (full file, not truncated).
Do NOT include markdown, language tags, or JSON wrapping.

Workflow Logs:
${
  logs.length > 20000
    ? logs.substring(0, 5000) +
      "\n\n...[TRUNCATED TO COMBAT TOKEN LIMITS]...\n\n" +
      logs.substring(logs.length - 15000)
    : logs
}`;

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
    rawText = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

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
      throw new Error(
        `AI response missing required fields. Parsed keys: ${Object.keys(aiData).join(", ")}`,
      );
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
