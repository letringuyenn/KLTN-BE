const mongoose = require("mongoose");

const DocumentationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      default: "Uncategorized",
      trim: true,
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "documentation_sections",
  },
);

DocumentationSchema.index({ slug: 1, createdAt: -1 });

module.exports = mongoose.model("Documentation", DocumentationSchema);
