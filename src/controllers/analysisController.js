const {
  getHistoryForRequester,
  createAutoFixPullRequest,
} = require("../services/analysisService");
const AnalysisJob = require("../models/AnalysisJob");
const User = require("../models/User");

function mapJobStatusForClient(status) {
  switch (status) {
    case "pending":
      return "QUEUED";
    case "processing":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return String(status || "PENDING").toUpperCase();
  }
}

/**
 * POST /api/analysis/analyze
 * Mongo-backed queue version: validates input, creates a pending AnalysisJob,
 * returns 202 immediately with the job id for frontend polling.
 */
const analyzeWorkflow = async (req, res) => {
  try {
    const { repoUrl, workflowRunId } = req.body;
    const userId = req.user?.userId || req.user?.id;
    const customApiKeyHeader = req.headers["x-gemini-key"];
    const customApiKey = Array.isArray(customApiKeyHeader)
      ? customApiKeyHeader[0]
      : customApiKeyHeader;

    const user = await User.findById(userId).select("githubAccessToken");
    if (!user || !user.githubAccessToken) {
      return res.status(401).json({
        success: false,
        error: "GitHub token not found",
      });
    }

    if (!repoUrl) {
      return res.status(400).json({
        success: false,
        error: "repoUrl is required",
      });
    }

    const job = await AnalysisJob.create({
      userId,
      payload: {
        repoUrl,
        workflowRunId,
        runId: workflowRunId,
        githubToken: user.githubAccessToken,
        customApiKey,
      },
      status: "pending",
    });

    return res.status(202).json({
      success: true,
      jobId: job._id,
      status: mapJobStatusForClient(job.status),
      message:
        "Analysis job queued. Poll GET /api/analysis/:id/status for results.",
    });
  } catch (error) {
    console.error("Analyze workflow controller error:", error);
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 500 ? "Workflow analysis failed" : error.message,
      details: error.details || error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

/**
 * GET /api/analysis/:id/status
 * Returns current analysis status and full result when COMPLETED.
 */
const getAnalysisStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;

    const job = await AnalysisJob.findById(id).lean();

    if (!job) {
      return res.status(404).json({ error: "Analysis job not found" });
    }

    // Users can only view their own analyses; admins can view all.
    if (req.user?.role !== "ADMIN" && job.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (job.status === "pending" || job.status === "processing") {
      return res.status(202).json({
        success: true,
        jobId: job._id,
        status: mapJobStatusForClient(job.status),
        message: "Analysis job is still processing",
      });
    }

    if (job.status === "failed") {
      return res.status(200).json({
        success: true,
        jobId: job._id,
        status: mapJobStatusForClient(job.status),
        errorMessage: job.errorMessage || "Analysis failed",
      });
    }

    const response = {
      success: true,
      jobId: job._id,
      status: mapJobStatusForClient(job.status),
    };

    if (job.status === "completed") {
      response.result = job.result;
    }

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch analysis status",
      details: error.message,
    });
  }
};

/**
 * GET /api/analysis/history
 */
const getHistory = async (req, res) => {
  try {
    const requesterId = req.user?.userId || req.user?.id;
    const requesterRole = req.user?.role;

    const result = await getHistoryForRequester({
      requesterId,
      requesterRole,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      analyses: result.analyses,
      pagination: result.pagination,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error:
        status === 500 ? "Failed to fetch analysis history" : error.message,
      details: error.details || error.message,
    });
  }
};

/**
 * POST /api/analysis/:analysisId/create-pr
 */
const createAutoFixPr = async (req, res) => {
  try {
    const analysisId = req.params.analysisId || req.body.analysisId;
    const userId = req.user?.userId || req.user?.id;
    const user = await User.findById(userId).select("githubAccessToken");

    if (!user || !user.githubAccessToken) {
      return res.status(401).json({
        success: false,
        error: "GitHub token not found",
      });
    }

    const result = await createAutoFixPullRequest({
      analysisId,
      userId,
      githubToken: user.githubAccessToken,
    });

    return res.status(200).json({
      success: true,
      prUrl: result.prUrl,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 500 ? "Failed to create pull request" : error.message,
      details: error.details || error.message,
    });
  }
};

module.exports = {
  analyzeWorkflow,
  getHistory,
  createAutoFixPr,
  getAnalysisStatus,
};
