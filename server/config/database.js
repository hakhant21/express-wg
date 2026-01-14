const mongoose = require("mongoose");
require("dotenv").config();

class Database {
  constructor() {
    this._connect();
  }

  async _connect() {
    const mongoURI =
      process.env.MONGODB_URI ||
      "mongodb://localhost:27017/wireguard_dashboard";

    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      w: "majority",
    };

    try {
      await mongoose.connect(mongoURI, options);

      console.log("✅ MongoDB connected successfully");

      // Connection events
      mongoose.connection.on("error", (err) => {
        console.error("❌ MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        console.log("⚠️ MongoDB disconnected. Attempting to reconnect...");
        setTimeout(() => this._connect(), 5000);
      });

      mongoose.connection.on("reconnected", () => {
        console.log("✅ MongoDB reconnected");
      });

      mongoose.connection.on("connected", () => {
        console.log("✅ MongoDB connected");
      });
    } catch (error) {
      console.error("❌ MongoDB connection failed:", error);

      // Retry connection in production
      if (process.env.NODE_ENV === "production") {
        console.log("Retrying connection in 5 seconds...");
        setTimeout(() => this._connect(), 5000);
      } else {
        process.exit(1);
      }
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log("✅ MongoDB disconnected");
    } catch (error) {
      console.error("❌ Error disconnecting MongoDB:", error);
    }
  }

  async ping() {
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getStats() {
    try {
      const stats = await mongoose.connection.db.stats();
      return {
        collections: stats.collections,
        objects: stats.objects,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexSize: stats.indexSize,
      };
    } catch (error) {
      return null;
    }
  }

  async cleanup() {
    if (process.env.NODE_ENV === "test") {
      await mongoose.connection.dropDatabase();
      console.log("✅ Test database cleaned up");
    }
  }

  async createIndexes() {
    try {
      // Create all indexes defined in schemas
      await mongoose.model("Server").createIndexes();
      await mongoose.model("Peer").createIndexes();
      await mongoose.model("MTUProfile").createIndexes();
      console.log("✅ Database indexes created");
    } catch (error) {
      console.error("❌ Error creating indexes:", error);
    }
  }
}

module.exports = new Database();
