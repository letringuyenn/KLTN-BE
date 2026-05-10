const User = require("../models/User");
const { encryptString } = require("../utils/crypto");

/**
 * Update current user settings
 * @route PUT /api/users/settings
 * @headers Authorization: Bearer <token>
 * @body {string} username
 */
const updateUserSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username } = req.body;

    if (!username || typeof username !== "string" || !username.trim()) {
      return res.status(400).json({
        error: "username is required",
      });
    }

    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 2 || normalizedUsername.length > 40) {
      return res.status(400).json({
        error: "username must be between 2 and 40 characters",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username: normalizedUsername },
      { new: true, runValidators: true },
    ).select("_id username avatar role githubId createdAt updatedAt");

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: updatedUser._id,
        username: updatedUser.username,
        avatar: updatedUser.avatar,
        role: updatedUser.role,
        githubId: updatedUser.githubId,
      },
    });
  } catch (error) {
    console.error("Error updating user settings:", error.message);
    return res.status(500).json({
      error: "Failed to update user settings",
      details: error.message,
    });
  }
};

/**
 * PUT /api/users/byok
 * Save or remove encrypted Gemini API key for PRO users.
 */
const updateByokSettings = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { geminiApiKey, clear } = req.body || {};

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "USER") {
      return res.status(403).json({
        error: "BYOK is only available in client workspace",
      });
    }

    if (user.tier !== "PRO") {
      return res.status(403).json({
        error: "BYOK is available for PRO users only",
        code: "PRO_REQUIRED",
      });
    }

    if (clear === true) {
      user.encryptedGeminiApiKey = null;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "BYOK removed successfully",
        hasCustomGeminiKey: false,
      });
    }

    if (typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
      return res.status(400).json({ error: "geminiApiKey is required" });
    }

    const normalizedKey = geminiApiKey.trim();
    if (normalizedKey.length < 20) {
      return res.status(400).json({
        error: "geminiApiKey appears invalid",
      });
    }

    user.encryptedGeminiApiKey = encryptString(normalizedKey);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "BYOK saved securely",
      hasCustomGeminiKey: true,
    });
  } catch (error) {
    console.error("Error updating BYOK settings:", error.message);
    return res.status(500).json({
      error: "Failed to update BYOK settings",
      details: error.message,
    });
  }
};

module.exports = {
  updateUserSettings,
  updateByokSettings,
};
