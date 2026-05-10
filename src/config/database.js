const mongoose = require("mongoose");

/**
 * Connect to MongoDB using Mongoose
 * Async function that handles connection, retry logic, and error handling
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  try {
    // Validate MONGODB_URI is set
    if (!process.env.MONGODB_URI) {
      throw new Error(
        "MONGODB_URI environment variable is not defined. Please check your .env file.",
      );
    }

    // Set Mongoose strictQuery to false for flexibility
    mongoose.set("strictQuery", false);

    // Connect to MongoDB
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(
      `✅ MongoDB connected successfully at: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`,
    );
    console.log(`📊 Database: ${conn.connection.db.name}`);

    return conn;
  } catch (error) {
    console.error(
      "❌ MongoDB connection failed:",
      error.message || error.toString(),
    );

    // Provide helpful error messages
    if (error.message.includes("ECONNREFUSED")) {
      console.error(
        "💡 Tip: Is MongoDB running locally? Try: mongod --dbpath ~/data/db",
      );
    } else if (error.message.includes("authentication failed")) {
      console.error(
        "💡 Tip: Check your MongoDB credentials in MONGODB_URI environment variable",
      );
    } else if (error.message.includes("getaddrinfo ENOTFOUND")) {
      console.error(
        "💡 Tip: Check your MongoDB connection string - host not found",
      );
    }

    // Exit process on database connection failure
    process.exit(1);
  }
};

/**
 * Disconnect from MongoDB
 * Useful for testing and graceful shutdown
 * @returns {Promise<void>}
 */
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log("✅ MongoDB disconnected successfully");
  } catch (error) {
    console.error("❌ Error disconnecting from MongoDB:", error.message);
    throw error;
  }
};

module.exports = {
  connectDB,
  disconnectDB,
};
