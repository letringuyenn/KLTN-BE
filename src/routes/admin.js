const express = require("express");
const { auth, isAdmin } = require("../middleware/auth");
const {
  getAdminHistory,
  getAdminUsers,
  updateUserRole,
  updateUserAccess,
  getFinanceSummary,
  getFinanceTransactions,
  getAdminRevenue,
  getFeedbackTickets,
  resolveFeedbackTicket,
  syncAiKnowledge,
  getSystemStats,
  getGlobalLogs,
  getAuditLogs,
} = require("../controllers/adminController");

const router = express.Router();

router.use(auth, isAdmin);

/**
 * GET /api/admin/history
 * Fetch all analysis records with populated user context.
 */
router.get("/history", getAdminHistory);

/**
 * GET /api/admin/users
 * Fetch all users.
 */
router.get("/users", getAdminUsers);

/**
 * PUT /api/admin/users/:id/role
 * Update user role to USER or ADMIN.
 */
router.put("/users/:id/role", updateUserRole);

/**
 * PUT /api/admin/users/:id/access
 * Update user role/tier in one operation.
 */
router.put("/users/:id/access", updateUserAccess);

/**
 * GET /api/admin/finance/summary
 * Get finance KPI snapshot.
 */
router.get("/finance/summary", getFinanceSummary);

/**
 * GET /api/admin/finance/transactions
 * Fetch transaction history for the Finance page.
 */
router.get("/finance/transactions", getFinanceTransactions);

/**
 * GET /api/admin/revenue
 * Aggregate completed transactions and recent PRO upgrades.
 */
router.get("/revenue", getAdminRevenue);

/**
 * GET /api/admin/feedback
 * Fetch all feedback tickets.
 */
router.get("/feedback", getFeedbackTickets);

/**
 * PUT /api/admin/feedback/:id/resolve
 * Resolve feedback and persist admin reply.
 */
router.put("/feedback/:id/resolve", resolveFeedbackTicket);

/**
 * POST /api/admin/sync-ai
 * Trigger mock AI synchronization process.
 */
router.post("/sync-ai", syncAiKnowledge);

/**
 * GET /api/admin/stats
 * System-wide statistics snapshot.
 */
router.get("/stats", getSystemStats);

/**
 * GET /api/admin/logs
 * Global analysis logs with optional ?status filter.
 */
router.get("/logs", getGlobalLogs);

/**
 * GET /api/admin/audit-logs/:userId
 * Audit trail for a specific user.
 */
router.get("/audit-logs/:userId", getAuditLogs);

/**
 * Compatibility aliases for existing frontend clients.
 */
router.get("/feedbacks", getFeedbackTickets);
router.put("/feedbacks/:id/resolve", resolveFeedbackTicket);
router.post("/ai/sync-knowledge", syncAiKnowledge);

module.exports = router;
