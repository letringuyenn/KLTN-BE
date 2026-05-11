require("dotenv").config();
const AnalysisJob = require("../models/AnalysisJob");

const POLL_INTERVAL_MS = parseInt(
  process.env.ANALYSIS_WORKER_POLL_MS || "5000",
  10,
);

let pollTimer = null;
let isPolling = false;

async function runAnalysisJob(job) {
  const { analyzeWorkflowForUser } = require("../services/analysisService");
  const { repoUrl, workflowRunId, customApiKey, githubToken } =
    job.payload || {};

  const createdAnalysis = await analyzeWorkflowForUser({
    repoUrl,
    workflowRunId,
    userId: job.userId,
    customApiKey,
    githubToken,
  });

  return createdAnalysis?.toObject
    ? createdAnalysis.toObject()
    : createdAnalysis;
}

async function processNextPendingJob() {
  if (isPolling) {
    return;
  }

  isPolling = true;

  try {
    // Recover stuck jobs (processing for > 5 minutes)
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    await AnalysisJob.updateMany(
      { status: "processing", updatedAt: { $lt: fiveMinsAgo } },
      { $set: { status: "failed", errorMessage: "Job crashed or timed out unexpectedly" } }
    );

    const job = await AnalysisJob.findOneAndUpdate(
      { status: "pending" },
      { $set: { status: "processing" } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );

    if (!job) {
      return;
    }

    try {
      const result = await runAnalysisJob(job);
      await AnalysisJob.findByIdAndUpdate(job._id, {
        status: "completed",
        result,
        errorMessage: null,
      });

      console.log(
        `[Worker] Job ${job._id} completed — analysis: ${result?._id}`,
      );
    } catch (error) {
      const errorMessage =
        typeof error?.message === "string"
          ? error.message
          : "Unknown analysis worker error";

      console.error(`[Worker] Job ${job._id} failed:`, errorMessage);

      await AnalysisJob.findByIdAndUpdate(job._id, {
        status: "failed",
        errorMessage,
      });
    }
  } catch (error) {
    console.error(
      "[Worker] Poll cycle error:",
      typeof error?.message === "string" ? error.message : "Unknown error",
    );
  } finally {
    isPolling = false;
  }
}

async function startAnalysisWorker() {
  console.log(
    `[Worker] MongoDB-backed analysis worker started — poll interval: ${POLL_INTERVAL_MS}ms`,
  );

  await processNextPendingJob();
  if (!pollTimer) {
    pollTimer = setInterval(processNextPendingJob, POLL_INTERVAL_MS);
  }
}

async function stopAnalysisWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

if (require.main === module) {
  const { connectDB } = require("../config/database");
  connectDB()
    .then(() => startAnalysisWorker())
    .catch((error) => {
      console.error("[Worker] Failed to start analysis worker:", error);
      process.exit(1);
    });
}

module.exports = {
  startAnalysisWorker,
  stopAnalysisWorker,
  processNextPendingJob,
  runAnalysisJob,
};
