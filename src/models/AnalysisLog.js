const mongoose = require("mongoose");

/**
 * AnalysisLog Schema
 * Stores CI/CD pipeline analysis history with support for RAG (Retrieval-Augmented Generation)
 * Includes embedding vectors for future similarity search and vector-based retrieval
 */
const AnalysisLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Index for faster user-specific queries
    },
    repoFullName: {
      type: String,
      required: true,
      index: true, // Index for repository-specific queries
      example: "owner/repo-name",
    },
    runId: {
      type: String,
      required: true,
      index: true, // Index for workflow run lookups
    },
    branchName: {
      type: String,
      default: "main",
      index: true,
      // Workflow head branch (main, feature/*, fix/*, hotfix/*)
    },
    baseBranch: {
      type: String,
      default: null,
      index: true,
      // Workflow base/target branch where fixes should be merged (main, master, develop, etc.)
    },
    prNumber: {
      type: Number,
      default: null,
      // Optional PR number associated with this workflow run
    },
    rawErrorSnippet: {
      type: String,
      required: true,
      // Original error log/snippet from CI/CD pipeline
      // Preserved for context and debugging
    },
    aiResult: {
      rootCause: {
        type: String,
        required: true,
        // AI-generated root cause analysis
        // Example: "Dependency conflict: package-a v1.0 requires node >=14, but v12 is installed"
      },
      suggestedFix: {
        type: String,
        required: true,
        // AI-generated fix suggestion
        // Can include code snippet or configuration change
      },
    },
    suggestedFixText: {
      type: String,
      default: null,
      // Human-readable fix guidance shown in the UI
    },
    patchFiles: [
      {
        filePath: {
          type: String,
          required: true,
          trim: true,
        },
        fileContent: {
          type: String,
          required: true,
        },
      },
    ],
    reasoning_trace: {
      type: String,
      default: null,
      // Step-by-step reasoning emitted by AI for traceability
    },
    targetFile: {
      type: String,
      default: null,
      // AI-detected file path used by Auto-Fix PR flow
    },
    severity: {
      type: String,
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM",
      index: true,
    },
    prUrl: {
      type: String,
      default: null,
      // GitHub PR URL populated when user clicks "Auto-Fix"
      // Format: https://github.com/owner/repo/pull/123
    },
    embedding: {
      type: [Number], // Array of floats for vector representation
      default: null,
      // Stores Gemini text-embedding-004 or equivalent vector
      // Dimension typically 768 or 1024 depending on model
      // Used for:
      // - Similarity search (find similar past errors)
      // - RAG retrieval (augment AI context with similar cases)
      // - Clustering analysis (group related errors)
      // NOTE: Vector search index must be created via Atlas UI/CLI
      //       (type: "vectorSearch"), NOT as a Mongoose schema index.
    },
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "PENDING", "COMPLETED", "PR_CREATED", "FAILED"],
      default: "QUEUED",
    },
    errorMessage: {
      type: String,
      default: null,
      // Error details if analysis failed
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: "analysis_logs", // Explicit collection name
  },
);

// Compound index for efficient querying by user and creation date
AnalysisLogSchema.index({ userId: 1, createdAt: -1 });

// Compound index for repository analysis history
AnalysisLogSchema.index({ repoFullName: 1, createdAt: -1 });

module.exports = mongoose.model("AnalysisLog", AnalysisLogSchema);
