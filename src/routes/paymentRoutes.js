const express = require("express");
const { auth } = require("../middleware/auth");
const {
	demoCheckout,
	mockVerifyPayment,
} = require("../controllers/paymentController");

const router = express.Router();

router.post("/demo-checkout", auth, demoCheckout);
router.post("/mock-verify", auth, mockVerifyPayment);

module.exports = router;
