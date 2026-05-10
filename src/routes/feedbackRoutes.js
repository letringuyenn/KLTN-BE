const express = require("express");
const router = express.Router();

const { auth } = require("../middleware/auth");
const {
  submitFeedback,
  getFeedbackNotifications,
  markFeedbackNotificationAsRead,
} = require("../controllers/feedbackController");

/**
 * @route POST /api/feedback
 * @headers Authorization: Bearer <token>
 * @body {string} message
 * @returns {object} created feedback info
 */
router.post("/", auth, submitFeedback);
router.get("/notifications", auth, getFeedbackNotifications);
router.put("/:id/read", auth, markFeedbackNotificationAsRead);

module.exports = router;
