const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: "USD",
    },
    status: {
      type: String,
      required: true,
      enum: ["PENDING", "COMPLETED", "FAILED", "REFUNDED"],
      default: "COMPLETED",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "transactions",
  },
);

TransactionSchema.index({ status: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
