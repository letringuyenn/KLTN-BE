/**
 * Feedback Controller
 * HTTP handlers for client-side feedback operations.
 * Delegates to feedbackService for business logic.
 *
 * @module controllers/feedbackController
 */

const mongoose = require("mongoose");
const feedbackService = require("../services/feedbackService");

/**
 * POST /api/feedback
 * Submit user feedback.
 */
const submitFeedback = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { message } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User context is missing" });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const normalizedMessage = message.trim();
    if (normalizedMessage.length < 3 || normalizedMessage.length > 5000) {
      return res.status(400).json({
        error: "message must be between 3 and 5000 characters",
      });
    }

    const feedback = await feedbackService.createFeedback(
      userId,
      normalizedMessage,
    );

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
      feedback: {
        id: feedback._id,
        userId: feedback.userId,
        status: feedback.status,
        createdAt: feedback.createdAt,
      },
    });
  } catch (error) {
    console.error("Error submitting feedback:", error.message);
    return res.status(500).json({
      error: "Failed to submit feedback",
      details: error.message,
    });
  }
};

/**
 * GET /api/feedback/notifications
 * Return unread admin replies for current user feedback tickets.
 */
const getFeedbackNotifications = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User context is missing" });
    }

    const result = await feedbackService.getUnreadNotifications(userId);

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error fetching feedback notifications:", error.message);
    return res.status(500).json({
      error: "Failed to fetch feedback notifications",
      details: error.message,
    });
  }
};

/**
 * PUT /api/feedback/:id/read
 * Mark a feedback notification as read by current user.
 */
const markFeedbackNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "User context is missing" });
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid feedback id" });
    }

    const updated = await feedbackService.markAsRead(id, userId);

    if (!updated) {
      return res.status(404).json({
        error: "Feedback notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      id: updated._id,
    });
  } catch (error) {
    console.error(
      "Error marking feedback notification as read:",
      error.message,
    );
    return res.status(500).json({
      error: "Failed to mark notification as read",
      details: error.message,
    });
  }
};

module.exports = {
  submitFeedback,
  getFeedbackNotifications,
  markFeedbackNotificationAsRead,
};
