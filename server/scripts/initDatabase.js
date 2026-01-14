#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");
const Server = require("../models/Server");
const Peer = require("../models/Peer");
const MTUProfile = require("../models/MTUProfile");

async function initializeDatabase() {
  console.log("🚀 Initializing WireGuard Dashboard Database...");

  // Connect to database
  const mongoURI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/wireguard_dashboard";

  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error);
    process.exit(1);
  }

  // Create indexes
  console.log("📊 Creating database indexes...");
  try {
    await Server.createIndexes();
    await Peer.createIndexes();
    await MTUProfile.createIndexes();
    console.log("✅ Database indexes created");
  } catch (error) {
    console.error("❌ Error creating indexes:", error);
  }

  // Initialize default MTU profiles
  console.log("📝 Initializing default MTU profiles...");
  try {
    await MTUProfile.initDefaults();
    console.log("✅ Default MTU profiles initialized");
  } catch (error) {
    console.error("❌ Error initializing MTU profiles:", error);
  }

  // Create sample data for development
  if (process.env.NODE_ENV === "development") {
    console.log("🧪 Creating sample data for development...");
    try {
      await createSampleData();
      console.log("✅ Sample data created");
    } catch (error) {
      console.error("❌ Error creating sample data:", error);
    }
  }

  console.log("\n🎉 Database initialization complete!");
  console.log("📁 Next steps:");
  console.log("   1. Run the server: npm start");
  console.log("   2. Access dashboard: http://localhost:3000");
  console.log("   3. Create your first WireGuard interface");

  await mongoose.disconnect();
  process.exit(0);
}

async function createSampleData() {
  // Create sample servers for Myanmar ISPs
  const isps = ["MPT", "OOREDOO", "MYTEL", "ATOM"];

  for (let i = 0; i < 3; i++) {
    const isp = isps[i % isps.length];
    const { exec } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);

    const privateKey = (await execAsync("wg genkey")).stdout.trim();
    const publicKey = (
      await execAsync(`echo "${privateKey}" | wg pubkey`)
    ).stdout.trim();

    const server = new Server({
      name: `${isp} Server ${i + 1}`,
      description: `Sample ${isp} VPN server for testing`,
      interfaceName: `wg${i}`,
      address: `10.${i}.0.1/24`,
      listenPort: 51820 + i,
      privateKey,
      publicKey,
      ispProfile: isp,
      mtu: 1400 + i * 20,
      dns: ["8.8.8.8", "8.8.4.4"],
      persistentKeepalive: 25,
      tags: [isp.toLowerCase(), "sample", "test"],
      notes: "This is a sample server for testing purposes",
    });

    await server.save();
    console.log(`   Created sample server: ${server.name}`);

    // Create sample peers
    for (let j = 1; j <= 5; j++) {
      const peerPrivateKey = (await execAsync("wg genkey")).stdout.trim();
      const peerPublicKey = (
        await execAsync(`echo "${peerPrivateKey}" | wg pubkey`)
      ).stdout.trim();

      const peer = new Peer({
        name: `Peer ${j} - ${isp}`,
        description: `Sample peer connected to ${server.name}`,
        server: server._id,
        serverId: server.serverId,
        interfaceName: server.interfaceName,
        privateKey: peerPrivateKey,
        publicKey: peerPublicKey,
        allowedIPs: [`10.${i}.0.${j + 1}/32`],
        assignedIP: `10.${i}.0.${j + 1}`,
        status: j <= 2 ? "connected" : "disconnected",
        isp: {
          type: isp,
          name: isp,
          country: "MM",
        },
        clientInfo: {
          deviceName: `Device-${j}`,
          platform: j % 2 === 0 ? "Windows" : "Android",
          os: j % 2 === 0 ? "Windows 10" : "Android 12",
          clientType: j % 2 === 0 ? "desktop" : "mobile",
        },
        tags: [isp.toLowerCase(), "sample"],
        dataTransferred: {
          received: Math.floor(Math.random() * 1000000000),
          sent: Math.floor(Math.random() * 500000000),
        },
      });

      await peer.save();
      console.log(`     Created sample peer: ${peer.name}`);
    }
  }
}

// Run initialization
initializeDatabase().catch(console.error);
