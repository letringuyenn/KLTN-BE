const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  updateUserSettings,
  updateByokSettings,
} = require("../controllers/userController");

/**
 * @route PUT /api/users/settings
 * @headers Authorization: Bearer <token>
 * @body {string} username
 * @returns {object} updated user
 */
router.put("/settings", auth, updateUserSettings);
router.put("/byok", auth, updateByokSettings);

module.exports = router;
