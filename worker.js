require("dotenv").config();
const {
  startAnalysisWorker,
  stopAnalysisWorker,
} = require("./src/workers/analysisWorker");

async function gracefulShutdown(signal) {
  console.log(`[Worker] Received ${signal}, stopping analysis worker...`);
  await stopAnalysisWorker();
  process.exit(0);
}

startAnalysisWorker().catch((error) => {
  console.error("[Worker] Failed to start analysis worker:", error);
  process.exit(1);
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
