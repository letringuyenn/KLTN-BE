const mongoose = require("mongoose");
const axios = require("axios");
const User = require("../models/User");
const AnalysisLog = require("../models/AnalysisLog");
const Feedback = require("../models/Feedback");
const KnowledgeBase = require("../models/KnowledgeBase");
const Transaction = require("../models/Transaction");

const DEFAULT_KB_SOURCE_URL =
  "https://raw.githubusercontent.com/github/docs/main/README.md";

const normalizeTags = (title, content) => {
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
};

const parseMarkdownKnowledge = (markdown, sourceUrl) => {
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

    return {
      title,
      content,
      sourceUrl,
      tags: normalizeTags(title, content),
    };
  });

  return documents.filter((doc) => doc.content.length > 0);
};

const normalizePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * GET /api/admin/history
 * Fetch all analysis records across the entire system.
 */
const getAdminHistory = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query);

    const [history, total] = await Promise.all([
      AnalysisLog.find({})
        .populate("userId", "username githubId avatar role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AnalysisLog.countDocuments({}),
    ]);

    return res.status(200).json({
      success: true,
      history,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching admin history:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch admin history",
      details: error.message,
    });
  }
};

/**
 * GET /api/admin/users
 * Fetch all users.
 */
const getAdminUsers = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query);

    const [users, total] = await Promise.all([
      User.find({})
        .select("_id username githubId avatar role tier createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments({}),
    ]);

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch users",
      details: error.message,
    });
  }
};

/**
 * PUT /api/admin/users/:id/role
 * Update role with { role: "USER" | "ADMIN" }.
 */
const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user id",
      });
    }

    if (!role || !["USER", "ADMIN"].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role",
        message: "Role must be either USER or ADMIN",
      });
    }

    const updatePayload =
      role === "ADMIN" ? { role, tier: "PRO", isFirstLogin: false } : { role };

    const updatedUser = await User.findByIdAndUpdate(id, updatePayload, {
      new: true,
      runValidators: true,
    })
      .select("_id username githubId avatar role tier createdAt updatedAt")
      .lean();

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user role:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update user role",
      details: error.message,
    });
  }
};

/**
 * GET /api/admin/feedback
 * Fetch all feedback tickets with populated user.
 */
const getFeedbackTickets = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query);

    const [feedback, total] = await Promise.all([
      Feedback.find({})
        .populate("userId", "username githubId avatar role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Feedback.countDocuments({}),
    ]);

    return res.status(200).json({
      success: true,
      feedback,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching feedback tickets:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch feedback tickets",
      details: error.message,
    });
  }
};

/**
 * PUT /api/admin/feedback/:id/resolve
 * Resolve ticket and save admin reply.
 */
const resolveFeedbackTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminReply } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid feedback id",
      });
    }

    if (typeof adminReply !== "string" || !adminReply.trim()) {
      return res.status(400).json({
        success: false,
        error: "adminReply is required",
      });
    }

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

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Feedback ticket not found",
      });
    }

    return res.status(200).json({
      success: true,
      feedback: updated,
    });
  } catch (error) {
    console.error("Error resolving feedback ticket:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to resolve feedback ticket",
      details: error.message,
    });
  }
};

/**
 * POST /api/admin/sync-ai
 * Synchronize public DevSecOps knowledge for lightweight RAG.
 */
const syncAiKnowledge = async (req, res) => {
  try {
    const sourceUrl = req.body?.sourceUrl || DEFAULT_KB_SOURCE_URL;
    const response = await axios.get(sourceUrl, {
      timeout: 15000,
      headers: {
        Accept: "text/plain, text/markdown, application/json",
      },
    });

    const payload =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data, null, 2);

    let docs = parseMarkdownKnowledge(payload, sourceUrl);

    if (docs.length === 0) {
      docs = [
        {
          title: "DevSecOps Sync Snapshot",
          content: payload.slice(0, 12000),
          sourceUrl,
          tags: ["devsecops", "github-actions", "security"],
        },
      ];
    }

    // ✅ FIX: APPEND new knowledge instead of DELETE old data
    // This way, knowledge base grows and accumulates solutions over time
    const upsertedDocs = [];

    for (const doc of docs) {
      // Check if document already exists by title and sourceUrl
      const existingDoc = await KnowledgeBase.findOne({
        title: doc.title,
        sourceUrl: doc.sourceUrl,
      });

      if (existingDoc) {
        // Update existing document
        await KnowledgeBase.updateOne(
          { _id: existingDoc._id },
          {
            content: doc.content,
            tags: doc.tags,
            updatedAt: new Date(),
          },
        );
        upsertedDocs.push(existingDoc._id);
      } else {
        // Insert new document
        const inserted = await KnowledgeBase.create(doc);
        upsertedDocs.push(inserted._id);
      }
    }

    const syncedCount = upsertedDocs.length;

    console.log(
      `[Admin] AI Knowledge synced: ${syncedCount} documents (APPEND mode, not DELETE)`,
    );

    return res.status(200).json({
      success: true,
      syncedCount,
      sourceUrl,
      message: `Synchronized ${syncedCount} knowledge document(s). Data is accumulated, not replaced.`,
    });
  } catch (error) {
    console.error("Error synchronizing AI knowledge:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to synchronize AI knowledge",
      details: error.message,
    });
  }
};

/**
 * PUT /api/admin/users/:id/access
 * Update role/tier with { role?: "USER"|"ADMIN", tier?: "FREE"|"PRO" }.
 */
const updateUserAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, tier } = req.body;
    const requesterId = req.user?.userId || req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user id",
      });
    }

    const requestedRole = role ? String(role).toUpperCase() : undefined;
    const requestedTier = tier ? String(tier).toUpperCase() : undefined;

    if (requestedRole && !["USER", "ADMIN"].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role",
      });
    }

    if (requestedTier && !["FREE", "PRO"].includes(requestedTier)) {
      return res.status(400).json({
        success: false,
        error: "Invalid tier",
      });
    }

    const existingUser = await User.findById(id);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    if (
      requesterId &&
      requesterId.toString() === id.toString() &&
      requestedRole === "USER"
    ) {
      return res.status(403).json({
        success: false,
        error: "You cannot demote your own admin account",
      });
    }

    const nextRole = requestedRole || existingUser.role;
    const nextTier =
      nextRole === "ADMIN" ? "PRO" : requestedTier || existingUser.tier;

    const updatePayload = {
      role: nextRole,
      tier: nextTier,
    };

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

    return res.status(200).json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user access:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update user access",
      details: error.message,
    });
  }
};

/**
 * GET /api/admin/finance/summary
 * Return admin financial snapshot derived from PRO user subscriptions.
 */
const getFinanceSummary = async (req, res) => {
  try {
    const monthlyPrice = Number(process.env.PRO_MONTHLY_PRICE_USD || 19);

    const [proUsers, totalUsers] = await Promise.all([
      User.countDocuments({ role: "USER", tier: "PRO" }),
      User.countDocuments({ role: "USER" }),
    ]);

    return res.status(200).json({
      success: true,
      finance: {
        monthlyPriceUsd: monthlyPrice,
        proUsers,
        totalUsers,
        totalProfitUsd: proUsers * monthlyPrice,
      },
    });
  } catch (error) {
    console.error("Error fetching finance summary:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch finance summary",
      details: error.message,
    });
  }
};

/**
 * GET /api/admin/finance/transactions
 * Return transaction history with populated user context.
 */
const getFinanceTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({})
      .populate("userId", "username githubId avatar role")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      transactions: Array.isArray(transactions) ? transactions : [],
    });
  } catch (error) {
    console.error("Error fetching finance transactions:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch finance transactions",
      details: error.message,
    });
  }
};

/**
 * GET /api/admin/revenue
 * Aggregate completed transactions for total revenue and show recent PRO users.
 */
const getAdminRevenue = async (req, res) => {
  try {
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

    return res.status(200).json({
      success: true,
      revenue: {
        totalRevenue: Number(snapshot.totalRevenue || 0),
        totalTransactions: Number(snapshot.totalTransactions || 0),
        currency: "USD",
      },
      recentProUsers,
    });
  } catch (error) {
    console.error("Error fetching admin revenue:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch admin revenue",
      details: error.message,
    });
  }
};

/**
 * Backward-compatible exports used by older routes.
 */
const getSystemStats = async (req, res) => {
  try {
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

    return res.status(200).json({
      success: true,
      users,
      admins,
      totalAnalyses,
      analysesByStatus: statusMap,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to fetch system statistics",
      details: error.message,
    });
  }
};

const getGlobalLogs = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query);
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
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

    return res.status(200).json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to fetch global logs",
      details: error.message,
    });
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query);
    const { userId } = req.params;
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

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to fetch audit logs",
      details: error.message,
    });
  }
};

module.exports = {
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
};
