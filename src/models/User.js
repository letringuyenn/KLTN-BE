const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    githubId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
    },
    githubAccessToken: {
      type: String,
      required: true,
      // AES-256-GCM encrypted token payload (enc:iv:tag:ciphertext)
    },
    encryptedGeminiApiKey: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["USER", "ADMIN"],
      default: "USER",
    },
    tier: {
      type: String,
      enum: ["FREE", "PRO"],
      default: "FREE",
      index: true,
    },
    analyzeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastResetDate: {
      type: Date,
      default: Date.now,
    },
    isFirstLogin: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.pre("validate", function enforceAdminTier() {
  if (this.role === "ADMIN") {
    this.tier = "PRO";
    this.analyzeCount = 0;
    this.encryptedGeminiApiKey = null;
    if (this.isFirstLogin == null) {
      this.isFirstLogin = false;
    }
  }
});

module.exports = mongoose.model("User", UserSchema);
