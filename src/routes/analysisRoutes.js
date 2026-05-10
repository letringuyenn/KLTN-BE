const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const router = express.Router();
const {
  analyzeWorkflow,
  getHistory,
  createAutoFixPr,
  getAnalysisStatus,
} = require("../controllers/analysisController");
const { auth } = require("../middleware/auth");

/**
 * @route POST /api/analysis/analyze
 * @headers Authorization: Bearer <token>
 * @body {string} repoUrl - GitHub repository URL
 * @body {string} workflowRunId - (optional) Workflow run ID
 * @returns {object} Analysis result with rootCause and suggestedFix
 *
 * NOTE: Apply a strict rate limiter only to this POST analyze endpoint to
 * prevent abuse while allowing the client to freely poll the status
 * endpoint without being throttled.
 */
const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each authenticated user to 10 analysis requests per hour
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req), // Use userId if authenticated
  message: "Too many analysis requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/analyze", auth, analysisLimiter, analyzeWorkflow);

/**
 * @route GET /api/analyses
 * @headers Authorization: Bearer <token>
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Results per page (default: 10)
 * @returns {array} Role-scoped analysis history
 */
router.get("/", auth, getHistory);

/**
 * @route GET /api/analysis/history
 * @headers Authorization: Bearer <token>
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Results per page (default: 10)
 * @returns {array} User's analysis history
 */
router.get("/history", auth, getHistory);

/**
 * @route GET /api/analysis/:id/status
 * @headers Authorization: Bearer <token>
 * @returns {object} Current analysis status and result when completed
 */
router.get("/:id/status", auth, getAnalysisStatus);

/**
 * @route POST /api/analysis/:analysisId/create-pr
 * @headers Authorization: Bearer <token>
 * @body {string} analysisId - Optional when provided in route param
 * @returns {object} Created PR details (number, url, branch)
 */
router.post("/:analysisId/create-pr", auth, createAutoFixPr);
router.post("/auto-fix", auth, createAutoFixPr);

module.exports = router;
