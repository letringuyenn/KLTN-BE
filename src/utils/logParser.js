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

module.exports = {
  extractPrimaryErrorMessage,
  parseGitHubRepo,
  extractRunId,
};
