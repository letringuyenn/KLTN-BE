const express = require("express");
const { auth, isAdmin } = require("../middleware/auth");
const {
  getAdminDocs,
  getAdminDocById,
  createAdminDoc,
  updateAdminDoc,
  deleteAdminDoc,
} = require("../controllers/docsController");

const router = express.Router();

router.use(auth, isAdmin);

/**
 * GET /api/admin/docs
 * List all docs newest-first.
 */
router.get("/", getAdminDocs);

/**
 * GET /api/admin/docs/:id
 * Load a single doc for editing.
 */
router.get("/:id", getAdminDocById);

/**
 * POST /api/admin/docs
 * Create a new doc and auto-generate slug from title.
 */
router.post("/", createAdminDoc);

/**
 * PUT /api/admin/docs/:id
 * Update an existing doc.
 */
router.put("/:id", updateAdminDoc);

/**
 * DELETE /api/admin/docs/:id
 * Delete a doc.
 */
router.delete("/:id", deleteAdminDoc);

module.exports = router;
