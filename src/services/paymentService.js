const User = require("../models/User");
const Transaction = require("../models/Transaction");

async function completeDemoPaymentForUser(userId, { amount, currency }) {
  if (!userId) {
    const error = new Error("Unauthorized request");
    error.status = 401;
    throw error;
  }

  const existingUser = await User.findById(userId).select(
    "_id username avatar role tier isFirstLogin",
  );

  if (!existingUser) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const transaction = await Transaction.create({
    userId,
    amount,
    currency: String(currency || "USD").toUpperCase(),
    status: "COMPLETED",
  });

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      tier: "PRO",
      isFirstLogin: false,
      lastLogin: new Date(),
    },
    { new: true, runValidators: true },
  ).select("_id username avatar role tier isFirstLogin");

  return {
    transaction,
    user: updatedUser,
  };
}

module.exports = {
  completeDemoPaymentForUser,
};
