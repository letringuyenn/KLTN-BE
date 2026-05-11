require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { rateLimit } = require("express-rate-limit");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./src/config/database");

const app = express();

// ===== Security Middleware =====
app.use(helmet());

// ===== Logging Middleware =====
app.use(morgan("combined"));

// ===== Global Rate Limiting =====
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use("/api/", globalLimiter);

// NOTE: analysis-specific rate limiter is applied per-route inside
// `src/routes/analysisRoutes.js` so that polling endpoints (GET /:id/status)
// are not subject to strict limits.

// ===== Middleware =====
const allowedFrontendOrigin =
  process.env.FRONTEND_URL || process.env.CLIENT_URL;
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser or same-origin server requests without Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedFrontendOrigin && origin === allowedFrontendOrigin) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Initialize Mongoose Connection =====
connectDB().catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});

// ===== Routes =====
// Mount authentication routes
app.use("/api/auth", require("./src/routes/authRoutes"));

// Mount analysis routes (rate limiting for specific endpoints handled in router)
app.use("/api/analysis", require("./src/routes/analysisRoutes"));

// Mount documentation routes
app.use("/api/docs", require("./src/routes/docsRoutes"));
app.use("/api/admin/docs", require("./src/routes/adminDocsRoutes"));

// Mount admin routes (protected)
app.use("/api/admin", require("./src/routes/admin"));

// Mount user settings routes (protected)
app.use("/api/users", require("./src/routes/userRoutes"));

// Mount client feedback route (protected)
app.use("/api/feedback", require("./src/routes/feedbackRoutes"));

// Mount payment routes (protected)
app.use("/api/payment", require("./src/routes/paymentRoutes"));

// ===== / ========
app.get("/", (req, res) => {
  res.status(200).json({ message: "server oke" });
});
// ===== Health Check =====
app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Backend is running" });
});

// ===== Error Handling Middleware =====
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
