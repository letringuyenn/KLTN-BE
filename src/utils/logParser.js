/**
 * Log Parser Utilities
 * Shared parsing functions for CI/CD log analysis.
 * Used by both analysisService.js (sync path) and analysisWorker.js (async path).
 *
 * @module utils/logParser
 */

/**
 * Extract the first meaningful error line from raw CI/CD workflow logs.
 * Scans for common failure signatures (error, failed, exception, etc.)
 * and returns the most relevant line, or the first non-empty line as fallback.
 *
 * @param {string} logs - Raw workflow log output
 * @returns {string} Extracted error message (max 500 chars), or empty string
 */
function extractPrimaryErrorMessage(logs) {
  if (!logs || typeof logs !== "string") {
    return "";
  }

  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const prioritized = lines.find((line) =>
    /(error|failed|exception|enoent|eacces|timeout|cannot|module not found)/i.test(
      line,
    ),
  );

  return (prioritized || lines[0] || "").slice(0, 500);
}

/**
 * Parse a GitHub repository input into its constituent parts.
 * Accepts both full URLs (https://github.com/owner/repo) and
 * short format (owner/repo). Strips .git suffix and trailing slashes.
 *
 * @param {string} repoInput - Full GitHub URL or owner/repo short format
 * @returns {{ owner: string, repo: string, repoFullName: string } | null}
 */
function parseGitHubRepo(repoInput) {
  if (!repoInput || typeof repoInput !== "string") {
    return null;
  }

  const normalized = repoInput
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

  const fullUrlMatch = normalized.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#]|$)/i,
  );
  if (fullUrlMatch) {
    const owner = fullUrlMatch[1];
    const repo = fullUrlMatch[2];
    return { owner, repo, repoFullName: `${owner}/${repo}` };
  }

  const shortFormatMatch = normalized.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortFormatMatch) {
    const owner = shortFormatMatch[1];
    const repo = shortFormatMatch[2];
    return { owner, repo, repoFullName: `${owner}/${repo}` };
  }

  return null;
}

/**
 * Extract a GitHub Actions run ID from a URL string.
 *
 * @param {string} input - URL potentially containing /actions/runs/<id>
 * @returns {string | null} Extracted run ID, or null if not found
 */
function extractRunId(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const match = input.match(/\/actions\/runs\/(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Extract detailed test failure information from logs.
 * Parses test failure patterns including assertions, expected vs actual values.
 * Helps AI understand logic errors, not just syntax/runtime errors.
 *
 * @param {string} logs - Raw workflow log output
 * @returns {Array} Array of failure details: { testName, type, expected, actual, message }
 */
function extractTestFailureDetails(logs) {
  if (!logs || typeof logs !== "string") {
    return [];
  }

  const failures = [];
  const lines = logs.split("\n");

  // Pattern 1: Jest/Mocha style - "● Test name"
  const testNamePattern = /●\s+(.+?)$/gm;
  const expectedActualPattern =
    /Expected:\s*(.+?)\s+Received:\s*(.+?)(?:\n|$)/gi;
  const assertionPattern = /AssertionError:\s*(.+?)(?:\n|$)/gi;
  const failedPattern = /(\d+)\s+(?:test|spec).*?failed/i;

  // Extract test names
  let testMatch;
  while ((testMatch = testNamePattern.exec(logs)) !== null) {
    const testName = testMatch[1].trim();

    // Look for expected vs actual around this test
    let expectedActualMatch;
    while ((expectedActualMatch = expectedActualPattern.exec(logs)) !== null) {
      failures.push({
        testName,
        type: "assertion_mismatch",
        expected: expectedActualMatch[1].trim().slice(0, 200),
        actual: expectedActualMatch[2].trim().slice(0, 200),
        message: `Expected ${expectedActualMatch[1].trim().slice(0, 100)} but got ${expectedActualMatch[2].trim().slice(0, 100)}`,
      });
    }
  }

  // Pattern 2: "Expected X to equal Y"
  const equalityPattern =
    /Expected\s+(.+?)\s+to\s+(?:equal|be)\s+(.+?)(?:\n|,)/gi;
  let eqMatch;
  while ((eqMatch = equalityPattern.exec(logs)) !== null) {
    failures.push({
      testName: "Unknown",
      type: "equality_assertion",
      expected: eqMatch[2].trim().slice(0, 200),
      actual: eqMatch[1].trim().slice(0, 200),
      message: `Expected ${eqMatch[1].trim().slice(0, 100)} to be ${eqMatch[2].trim().slice(0, 100)}`,
    });
  }

  // Pattern 3: Assertion errors with messages
  let assertMatch;
  while ((assertMatch = assertionPattern.exec(logs)) !== null) {
    failures.push({
      testName: "Unknown",
      type: "assertion_error",
      expected: null,
      actual: null,
      message: assertMatch[1].trim().slice(0, 300),
    });
  }

  // Pattern 4: Simple "X failed" pattern
  const simpleFailPattern = /(\w+[\w\s]*)\s+(?:FAILED|failed|✕)/g;
  let simpleMatch;
  while ((simpleMatch = simpleFailPattern.exec(logs)) !== null) {
    const testName = simpleMatch[1].trim();
    if (testName.length < 100) {
      failures.push({
        testName,
        type: "test_failure",
        expected: null,
        actual: null,
        message: `Test "${testName}" failed`,
      });
    }
  }

  // Remove duplicates
  const uniqueFailures = Array.from(
    new Map(failures.map((f) => [f.message, f])).values(),
  );

  return uniqueFailures.slice(0, 10); // Return top 10 failures
}

module.exports = {
  extractPrimaryErrorMessage,
  parseGitHubRepo,
  extractRunId,
  extractTestFailureDetails,
};
