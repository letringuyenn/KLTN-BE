const mongoose = require("mongoose");

const FeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ["PENDING", "RESOLVED"],
      default: "PENDING",
      index: true,
    },
    adminReply: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },
    clientReadAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "feedbacks",
  },
);

FeedbackSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Feedback", FeedbackSchema);
