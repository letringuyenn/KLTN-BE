const express = require("express");
const {
  getPublishedDocs,
  getPublishedDocBySlug,
} = require("../controllers/docsController");

const router = express.Router();

/**
 * Public docs feed.
 * GET /api/docs
 */
router.get("/", getPublishedDocs);

/**
 * Public docs feed alias.
 * GET /api/docs/public
 */
router.get("/public", getPublishedDocs);

/**
 * Public docs detail.
 * GET /api/docs/:slug
 */
router.get("/:slug", getPublishedDocBySlug);

/**
 * Public docs detail alias.
 * GET /api/docs/public/:slug
 */
router.get("/public/:slug", getPublishedDocBySlug);

module.exports = router;
