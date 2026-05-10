/**
 * API Key Resolver Utility
 * Resolves the effective Gemini API key for a user based on BYOK settings.
 * Used by both analysisService.js (sync path) and analysisWorker.js (async path).
 *
 * @module utils/apiKeyResolver
 */

const { decryptString, isEncryptedString } = require("./crypto");

/**
 * Resolve the effective Gemini API key for a given user document.
 *
 * Priority order:
 * 1. Explicitly provided custom key (from request header x-gemini-key)
 * 2. User's stored encrypted BYOK key (PRO users only)
 * 3. Empty string (falls back to system GEMINI_API_KEY in aiService)
 *
 * @param {Object} user - Mongoose User document
 * @param {string} [customApiKey=""] - Optional key from request header
 * @returns {string} Resolved API key, or empty string for system fallback
 */
function resolveEffectiveApiKey(user, customApiKey = "") {
  // Priority 1: Explicit custom key from request
  const requestedCustomKey =
    typeof customApiKey === "string" ? customApiKey.trim() : "";

  if (requestedCustomKey) {
    return requestedCustomKey;
  }

  // Priority 2: User's stored BYOK key
  if (
    user.role === "USER" &&
    typeof user.encryptedGeminiApiKey === "string" &&
    user.encryptedGeminiApiKey.length > 0
  ) {
    try {
      return isEncryptedString(user.encryptedGeminiApiKey)
        ? decryptString(user.encryptedGeminiApiKey)
        : user.encryptedGeminiApiKey;
    } catch (error) {
      console.warn(
        `[apiKeyResolver] Failed to decrypt BYOK key for user ${user._id}, fallback to system key`,
      );
    }
  }

  // Priority 3: System key (resolved downstream in aiService)
  return "";
}

module.exports = {
  resolveEffectiveApiKey,
};
