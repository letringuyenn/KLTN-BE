/**
 * Admin Service Layer
 * Encapsulates all database queries and business logic for admin operations.
 * Controllers delegate to this service, keeping handlers thin (validate → delegate → respond).
 *
 * @module services/adminService
 */

const mongoose = require("mongoose");
const axios = require("axios");
const User = require("../models/User");
const AnalysisLog = require("../models/AnalysisLog");
const Feedback = require("../models/Feedback");
const KnowledgeBase = require("../models/KnowledgeBase");
const Transaction = require("../models/Transaction");

const DEFAULT_KB_SOURCE_URL =
  "https://raw.githubusercontent.com/github/docs/main/README.md";

// ─── Shared Helpers ───────────────────────────────────────────────

/**
 * Normalize pagination query params with sensible defaults and bounds.
 * @param {{ page?: string, limit?: string }} query
 * @returns {{ page: number, limit: number, skip: number }}
 */
function normalizePagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Build a standard pagination envelope.
 * @param {number} page
 * @param {number} limit
 * @param {number} total
 */
function paginationEnvelope(page, limit, total) {
  return { page, limit, total, pages: Math.ceil(total / limit) };
}

// ─── Knowledge Base Helpers ───────────────────────────────────────

/**
 * Extract tags from title and content for lightweight search.
 * @param {string} title
 * @param {string} content
 * @returns {string[]}
 */
function normalizeTags(title, content) {
  const haystack = `${title} ${content}`.toLowerCase();
  const dictionary = [
    "devsecops",
    "github-actions",
    "security",
    "workflow",
    "ci-cd",
    "compliance",
    "dependencies",
    "secrets",
  ];
  return dictionary.filter((tag) => haystack.includes(tag));
}

/**
 * Parse markdown text into knowledge base documents.
 * @param {string} markdown
 * @param {string} sourceUrl
 * @returns {Array<{ title: string, content: string, sourceUrl: string, tags: string[] }>}
 */
function parseMarkdownKnowledge(markdown, sourceUrl) {
  if (!markdown || typeof markdown !== "string") {
    return [];
  }

  const sections = markdown
    .split(/\n(?=#{1,3}\s+)/g)
    .map((section) => section.trim())
    .filter(Boolean);

  const documents = sections.map((section, index) => {
    const lines = section.split("\n");
    const heading = lines[0].match(/^#{1,3}\s+(.+)$/);
    const title = heading?.[1]?.trim() || `Section ${index + 1}`;
    const content = lines.slice(1).join("\n").trim() || section;
    return { title, content, sourceUrl, tags: normalizeTags(title, content) };
  });

  return documents.filter((doc) => doc.content.length > 0);
}

// ─── Stats & Logs ─────────────────────────────────────────────────

/**
 * Fetch system-wide statistics snapshot.
 * @returns {Promise<Object>}
 */
async function getSystemStats() {
  const [users, admins, totalAnalyses] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "ADMIN" }),
    AnalysisLog.countDocuments({}),
  ]);

  const analysesByStatus = await AnalysisLog.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusMap = analysesByStatus.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  return { users, admins, totalAnalyses, analysesByStatus: statusMap };
}

/**
 * Fetch paginated global analysis logs with optional status filter.
 * @param {{ page?: string, limit?: string, status?: string }} query
 * @returns {Promise<{ logs: Array, pagination: Object }>}
 */
async function getGlobalLogs(query) {
  const { page, limit, skip } = normalizePagination(query);
  const filter = {};
  if (query.status) {
    filter.status = query.status;
  }

  const [logs, total] = await Promise.all([
    AnalysisLog.find(filter)
      .populate("userId", "username githubId avatar role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AnalysisLog.countDocuments(filter),
  ]);

  return { logs, pagination: paginationEnvelope(page, limit, total) };
}

/**
 * Fetch paginated analysis history (all records, populated with user context).
 * @param {{ page?: string, limit?: string }} query
 * @returns {Promise<{ history: Array, pagination: Object }>}
 */
async function getAdminHistory(query) {
  const { page, limit, skip } = normalizePagination(query);
  const [history, total] = await Promise.all([
    AnalysisLog.find({})
      .populate("userId", "username githubId avatar role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AnalysisLog.countDocuments({}),
  ]);

  return { history, pagination: paginationEnvelope(page, limit, total) };
}

/**
 * Fetch audit logs for a specific user.
 * @param {string} userId
 * @param {{ page?: string, limit?: string }} query
 * @returns {Promise<{ data: Array, pagination: Object }>}
 */
async function getAuditLogs(userId, query) {
  const { page, limit, skip } = normalizePagination(query);
  const filter = {};

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    filter.userId = userId;
  }

  const [logs, total] = await Promise.all([
    AnalysisLog.find(filter)
      .populate("userId", "username githubId avatar role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AnalysisLog.countDocuments(filter),
  ]);

  return { data: logs, pagination: paginationEnvelope(page, limit, total) };
}

// ─── User Management ──────────────────────────────────────────────

/**
 * Fetch paginated user list.
 * @param {{ page?: string, limit?: string }} query
 * @returns {Promise<{ users: Array, pagination: Object }>}
 */
async function getUsers(query) {
  const { page, limit, skip } = normalizePagination(query);
  const [users, total] = await Promise.all([
    User.find({})
      .select("_id username githubId avatar role tier createdAt updatedAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments({}),
  ]);

  return { users, pagination: paginationEnvelope(page, limit, total) };
}

/**
 * Update a user's role.
 * @param {string} id - User ObjectId
 * @param {string} role - "USER" | "ADMIN"
 * @returns {Promise<Object>} Updated user
 */
async function updateUserRole(id, role) {
  const updatePayload =
    role === "ADMIN" ? { role, tier: "PRO", isFirstLogin: false } : { role };

  const updatedUser = await User.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  })
    .select("_id username githubId avatar role tier createdAt updatedAt")
    .lean();

  return updatedUser;
}

/**
 * Update a user's role and/or tier.
 * Self-demotion is prevented by the controller before calling this.
 *
 * @param {string} id - User ObjectId
 * @param {{ role?: string, tier?: string }} updates
 * @returns {Promise<Object>} Updated user
 */
async function updateUserAccess(id, updates) {
  const existingUser = await User.findById(id);
  if (!existingUser) {
    return null;
  }

  const nextRole = updates.role || existingUser.role;
  const nextTier =
    nextRole === "ADMIN" ? "PRO" : updates.tier || existingUser.tier;

  const updatePayload = { role: nextRole, tier: nextTier };

  if (nextRole === "ADMIN") {
    updatePayload.isFirstLogin = false;
    updatePayload.analyzeCount = 0;
    updatePayload.encryptedGeminiApiKey = null;
  }

  const updatedUser = await User.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  })
    .select("_id username githubId avatar role tier createdAt updatedAt")
    .lean();

  return updatedUser;
}

// ─── Feedback ─────────────────────────────────────────────────────

/**
 * Fetch paginated feedback tickets (admin view, populated with user).
 * @param {{ page?: string, limit?: string }} query
 * @returns {Promise<{ feedback: Array, pagination: Object }>}
 */
async function getFeedbackTickets(query) {
  const { page, limit, skip } = normalizePagination(query);
  const [feedback, total] = await Promise.all([
    Feedback.find({})
      .populate("userId", "username githubId avatar role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Feedback.countDocuments({}),
  ]);

  return { feedback, pagination: paginationEnvelope(page, limit, total) };
}

/**
 * Resolve a feedback ticket and save admin reply.
 * @param {string} id - Feedback ObjectId
 * @param {string} adminReply - Admin's response text
 * @returns {Promise<Object|null>} Updated feedback, or null if not found
 */
async function resolveFeedbackTicket(id, adminReply) {
  const updated = await Feedback.findByIdAndUpdate(
    id,
    {
      status: "RESOLVED",
      adminReply: adminReply.trim(),
      clientReadAt: null,
    },
    { new: true, runValidators: true },
  )
    .populate("userId", "username githubId avatar role")
    .lean();

  return updated;
}

// ─── Finance ──────────────────────────────────────────────────────

/**
 * Get financial summary snapshot.
 * @returns {Promise<Object>}
 */
async function getFinanceSummary() {
  const monthlyPrice = Number(process.env.PRO_MONTHLY_PRICE_USD || 19);

  const [proUsers, totalUsers] = await Promise.all([
    User.countDocuments({ role: "USER", tier: "PRO" }),
    User.countDocuments({ role: "USER" }),
  ]);

  return {
    monthlyPriceUsd: monthlyPrice,
    proUsers,
    totalUsers,
    totalProfitUsd: proUsers * monthlyPrice,
  };
}

/**
 * Aggregate revenue from completed transactions.
 * @returns {Promise<{ revenue: Object, recentProUsers: Array }>}
 */
async function getAdminRevenue() {
  const [revenueAgg, recentProUsers] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          totalTransactions: { $sum: 1 },
        },
      },
    ]),
    User.find({ role: "USER", tier: "PRO" })
      .select("_id username avatar tier updatedAt")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const snapshot = revenueAgg[0] || { totalRevenue: 0, totalTransactions: 0 };

  return {
    revenue: {
      totalRevenue: Number(snapshot.totalRevenue || 0),
      totalTransactions: Number(snapshot.totalTransactions || 0),
      currency: "USD",
    },
    recentProUsers,
  };
}

// ─── Knowledge Sync ───────────────────────────────────────────────

/**
 * Synchronize external DevSecOps knowledge into the KnowledgeBase collection.
 * @param {string} [sourceUrl] - Optional custom URL (defaults to GitHub docs)
 * @returns {Promise<{ syncedCount: number, sourceUrl: string }>}
 */
async function syncAiKnowledge(sourceUrl) {
  const effectiveUrl = sourceUrl || DEFAULT_KB_SOURCE_URL;
  const response = await axios.get(effectiveUrl, {
    timeout: 15000,
    headers: {
      Accept: "text/plain, text/markdown, application/json",
    },
  });

  const payload =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data, null, 2);

  let docs = parseMarkdownKnowledge(payload, effectiveUrl);

  if (docs.length === 0) {
    docs = [
      {
        title: "DevSecOps Sync Snapshot",
        content: payload.slice(0, 12000),
        sourceUrl: effectiveUrl,
        tags: ["devsecops", "github-actions", "security"],
      },
    ];
  }

  await KnowledgeBase.deleteMany({});
  const inserted = await KnowledgeBase.insertMany(docs, { ordered: true });

  return { syncedCount: inserted.length, sourceUrl: effectiveUrl };
}

module.exports = {
  getSystemStats,
  getGlobalLogs,
  getAdminHistory,
  getAuditLogs,
  getUsers,
  updateUserRole,
  updateUserAccess,
  getFeedbackTickets,
  resolveFeedbackTicket,
  getFinanceSummary,
  getAdminRevenue,
  syncAiKnowledge,
};
