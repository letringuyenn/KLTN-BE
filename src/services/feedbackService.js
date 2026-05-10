/**
 * Feedback Service Layer
 * Business logic for client-side feedback operations.
 *
 * @module services/feedbackService
 */

const mongoose = require("mongoose");
const Feedback = require("../models/Feedback");

/**
 * Create a new feedback ticket.
 *
 * @param {string} userId - Owner ObjectId
 * @param {string} message - Feedback message (3-5000 chars)
 * @returns {Promise<Object>} Created feedback document
 */
async function createFeedback(userId, message) {
  const feedback = await Feedback.create({
    userId,
    message,
    status: "PENDING",
  });
  return feedback;
}

/**
 * Get unread admin replies for a user's feedback tickets.
 *
 * @param {string} userId - User ObjectId
 * @returns {Promise<{ notifications: Array, unreadCount: number }>}
 */
async function getUnreadNotifications(userId) {
  const notifications = await Feedback.find({
    userId,
    status: "RESOLVED",
    adminReply: { $exists: true, $ne: "" },
    clientReadAt: null,
  })
    .select("_id message adminReply createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  return { notifications, unreadCount: notifications.length };
}

/**
 * Mark a specific feedback notification as read.
 *
 * @param {string} feedbackId - Feedback ObjectId
 * @param {string} userId - User ObjectId (ownership check)
 * @returns {Promise<Object|null>} Updated feedback, or null if not found
 */
async function markAsRead(feedbackId, userId) {
  const updated = await Feedback.findOneAndUpdate(
    { _id: feedbackId, userId },
    { clientReadAt: new Date() },
    { new: true },
  ).lean();

  return updated;
}

module.exports = {
  createFeedback,
  getUnreadNotifications,
  markAsRead,
};
