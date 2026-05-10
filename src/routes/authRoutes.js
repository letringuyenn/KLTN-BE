const express = require("express");
const router = express.Router();
const {
  redirectToGitHubAuth,
  handleGitHubCallback,
  getUserProfile,
  logoutUser,
} = require("../controllers/authController");
const { auth } = require("../middleware/auth");

/**
 * @route GET /api/auth/github/login
 * @query state - single-use CSRF token from frontend
 * @returns 302 redirect to GitHub consent page
 */
router.get("/github/login", redirectToGitHubAuth);

/**
 * @route POST /api/auth/github/callback
 * @body {string} githubId - GitHub user ID
 * @body {string} username - GitHub username
 * @body {string} avatar - GitHub avatar URL
 * @body {string} accessToken - GitHub access token
 * @returns {string} JWT token for subsequent authenticated requests
 */
router.post("/github/callback", handleGitHubCallback);

/**
 * @route GET /api/auth/profile
 * @headers Authorization: Bearer <token>
 * @returns {object} Current user profile
 */
router.get("/profile", auth, getUserProfile);

/**
 * @route POST /api/auth/logout
 * @returns {object} Logout confirmation
 */
router.post("/logout", logoutUser);

module.exports = router;
