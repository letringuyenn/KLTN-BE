const jwt = require("jsonwebtoken");

/**
 * Authentication middleware
 * Verifies JWT from HttpOnly cookie and attaches decoded payload to req.user
 */
const auth = (req, res, next) => {
  try {
    const token = req.cookies?.jwt;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Missing authentication cookie",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    return next();
  } catch (error) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  }
};

/**
 * RBAC middleware
 * Allows access only to ADMIN role
 */
const isAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User context not found",
      });
    }

    if (req.user.role !== "ADMIN") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Admin role required",
      });
    }

    return next();
  } catch (error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to validate admin role",
    });
  }
};

module.exports = {
  auth,
  isAdmin,
};
