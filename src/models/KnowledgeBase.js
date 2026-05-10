const mongoose = require("mongoose");

const knowledgeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "knowledge_base",
  },
);

knowledgeSchema.index({ title: "text", content: "text", tags: "text" });

module.exports = mongoose.model("KnowledgeBase", knowledgeSchema);
