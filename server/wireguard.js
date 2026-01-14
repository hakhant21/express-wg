const { exec, spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const Server = require("./models/Server");
const Peer = require("./models/Peer");
const MTUProfile = require("./models/MTUProfile");

const execAsync = util.promisify(exec);

class DatabaseWireGuardService {
  constructor(configPath = "/etc/wireguard") {
    this.configPath = configPath;
    this.ispProfiles = require("../config/isp-profiles.json");
    this.interfaces = new Set();
  }

  // ==================== INITIALIZATION ====================

  async initialize() {
    await this.discoverInterfaces();
    await this.syncAllToDatabase();
    console.log("✅ WireGuard service initialized with database");
  }

  // ==================== INTERFACE MANAGEMENT ====================

  async discoverInterfaces() {
    try {
      const { stdout } = await execAsync("ip link show");
      const interfaces = new Set();
      const lines = stdout.split("\n");

      lines.forEach((line) => {
        const match = line.match(/^\d+:\s+(\w+):/);
        if (match && match[1].startsWith("wg")) {
          interfaces.add(match[1]);
        }
      });

      this.interfaces = interfaces;
      return Array.from(interfaces);
    } catch (error) {
      console.error("Failed to discover interfaces:", error);
      return [];
    }
  }

  async createInterface(serverData) {
    // Validate interface name
    if (!serverData.interfaceName.match(/^wg\d+$/)) {
      throw new Error("Interface name must be in format wg0, wg1, etc.");
    }

    // Check if interface already exists
    const existing = await Server.findOne({
      interfaceName: serverData.interfaceName,
    });

    if (existing) {
      throw new Error(`Interface ${serverData.interfaceName} already exists`);
    }

    // Generate keys if not provided
    if (!serverData.privateKey) {
      serverData.privateKey = (await execAsync("wg genkey")).stdout.trim();
    }

    if (!serverData.publicKey && serverData.privateKey) {
      serverData.publicKey = (
        await execAsync(`echo "${serverData.privateKey}" | wg pubkey`)
      ).stdout.trim();
    }

    // Create server in database
    const server = new Server(serverData);
    await server.save();

    // Generate config file
    const configPath = path.join(
      this.configPath,
      `${server.interfaceName}.conf`
    );
    const configContent = server.getConfigContent();

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.chmod(configPath, 0o600);

    // Add to interfaces set
    this.interfaces.add(server.interfaceName);

    return {
      success: true,
      message: `Interface ${server.interfaceName} created successfully`,
      server: server.toPublicJSON(),
      configPath: configPath,
    };
  }

  async deleteInterface(interfaceName) {
    try {
      // Stop interface if running
      try {
        await this.stopInterface(interfaceName);
      } catch (e) {
        // Interface might not be running
      }

      // Remove from database
      const server = await Server.findOne({ interfaceName });
      if (server) {
        // Delete all peers associated with this server
        await Peer.deleteMany({ server: server._id });
        await server.deleteOne();
      }

      // Remove config file
      const configPath = path.join(this.configPath, `${interfaceName}.conf`);
      try {
        await fs.unlink(configPath);
      } catch (e) {
        // Config file might not exist
      }

      // Remove from interfaces set
      this.interfaces.delete(interfaceName);

      return {
        success: true,
        message: `Interface ${interfaceName} deleted successfully`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async startInterface(interfaceName) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error(`Server ${interfaceName} not found in database`);
    }

    try {
      await execAsync(`wg-quick up ${interfaceName}`);

      // Update server status
      await server.updateStatus("active");

      // Sync peers status from WireGuard
      await this.updatePeersStatus(interfaceName);

      return {
        success: true,
        message: "Interface started",
        server: server.toPublicJSON(),
      };
    } catch (error) {
      await server.updateStatus("error");
      throw new Error(`Failed to start interface: ${error.message}`);
    }
  }

  async stopInterface(interfaceName) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error(`Server ${interfaceName} not found in database`);
    }

    try {
      await execAsync(`wg-quick down ${interfaceName}`);

      // Update server status
      await server.updateStatus("inactive");

      // Update all peers as disconnected
      await Peer.updateMany(
        { server: server._id, status: "connected" },
        {
          status: "disconnected",
          lastSeen: new Date(),
        }
      );

      return {
        success: true,
        message: "Interface stopped",
        server: server.toPublicJSON(),
      };
    } catch (error) {
      await server.updateStatus("error");
      throw new Error(`Failed to stop interface: ${error.message}`);
    }
  }

  async restartInterface(interfaceName) {
    try {
      await this.stopInterface(interfaceName);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.startInterface(interfaceName);
      return { success: true, message: `Interface ${interfaceName} restarted` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== PEER MANAGEMENT ====================

  async addPeer(peerData) {
    try {
      // Generate new peer
      const peer = await Peer.generateNewPeer(peerData.server, peerData);

      // Add to WireGuard interface
      const server = await Server.findById(peerData.server);
      const cmd = `wg set ${server.interfaceName} peer ${
        peer.publicKey
      } allowed-ips ${peer.allowedIPs.join(",")}`;

      await execAsync(cmd);

      // Save config
      await execAsync(`wg-quick save ${server.interfaceName}`);

      // Generate config file for peer
      await peer.generateConfig();

      // Update server peer count
      await Server.findByIdAndUpdate(peerData.server, {
        $inc: { peerCount: 1 },
      });

      return {
        success: true,
        message: "Peer added successfully",
        peer: peer.toClientJSON(),
        config: peer.configFile,
        qrCode: peer.qrCode,
      };
    } catch (error) {
      throw new Error(`Failed to add peer: ${error.message}`);
    }
  }

  async removePeer(peerId) {
    try {
      const peer = await Peer.findById(peerId).populate("server");
      if (!peer) {
        throw new Error("Peer not found");
      }

      const { server } = peer;

      // Remove from WireGuard interface
      const cmd = `wg set ${server.interfaceName} peer ${peer.publicKey} remove`;
      await execAsync(cmd);

      // Save config
      await execAsync(`wg-quick save ${server.interfaceName}`);

      // Update peer status
      peer.status = "disabled";
      peer.enabled = false;
      await peer.save();

      // Update server peer count
      await Server.findByIdAndUpdate(server._id, {
        $inc: { peerCount: -1 },
      });

      return {
        success: true,
        message: "Peer removed successfully",
        peer: peer.toClientJSON(),
      };
    } catch (error) {
      throw new Error(`Failed to remove peer: ${error.message}`);
    }
  }

  async enablePeer(peerId) {
    const peer = await Peer.findById(peerId).populate("server");
    if (!peer) {
      throw new Error("Peer not found");
    }

    const { server } = peer;

    // Add peer back to WireGuard
    const cmd = `wg set ${server.interfaceName} peer ${
      peer.publicKey
    } allowed-ips ${peer.allowedIPs.join(",")}`;
    await execAsync(cmd);

    // Save config
    await execAsync(`wg-quick save ${server.interfaceName}`);

    peer.enabled = true;
    peer.status = "pending";
    await peer.save();

    return {
      success: true,
      message: "Peer enabled successfully",
      peer: peer.toClientJSON(),
    };
  }

  async disablePeer(peerId) {
    const peer = await Peer.findById(peerId).populate("server");
    if (!peer) {
      throw new Error("Peer not found");
    }

    const { server } = peer;

    // Remove from WireGuard
    const cmd = `wg set ${server.interfaceName} peer ${peer.publicKey} remove`;
    await execAsync(cmd);

    // Save config
    await execAsync(`wg-quick save ${server.interfaceName}`);

    peer.enabled = false;
    peer.status = "disabled";
    await peer.save();

    return {
      success: true,
      message: "Peer disabled successfully",
      peer: peer.toClientJSON(),
    };
  }

  async updatePeersStatus(interfaceName) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error("Server not found");
    }

    // Get current status from WireGuard
    let wgOutput;
    try {
      const { stdout } = await execAsync(`wg show ${interfaceName}`);
      wgOutput = stdout;
    } catch (error) {
      // Interface might not be running
      await Peer.updateMany(
        { server: server._id, status: "connected" },
        { status: "disconnected" }
      );
      return;
    }

    // Parse WireGuard output
    const connectedPeers = new Set();
    const lines = wgOutput.split("\n");
    let currentPeer = null;

    for (const line of lines) {
      if (line.includes("peer:")) {
        if (currentPeer && currentPeer.publicKey) {
          connectedPeers.add(currentPeer.publicKey.trim());
        }
        currentPeer = { publicKey: line.split(":")[1].trim() };
      } else if (line.includes("transfer:")) {
        const transfer = line.split(":")[1].trim();
        const [received, sent] = transfer.split(", ");
        if (currentPeer) {
          currentPeer.transfer = { received, sent };
        }
      }
    }

    if (currentPeer && currentPeer.publicKey) {
      connectedPeers.add(currentPeer.publicKey.trim());
    }

    // Update database
    const peers = await Peer.find({ server: server._id });

    for (const peer of peers) {
      const isConnected = connectedPeers.has(peer.publicKey);

      if (isConnected && peer.status !== "connected") {
        peer.status = "connected";
        peer.lastHandshake = new Date();
        peer.lastSeen = new Date();

        if (!peer.firstSeen) {
          peer.firstSeen = new Date();
        }

        peer.connectionCount += 1;
      } else if (!isConnected && peer.status === "connected") {
        peer.status = "disconnected";
      }

      await peer.save();
    }

    // Update server active peers count
    server.activePeers = await Peer.countDocuments({
      server: server._id,
      status: "connected",
      enabled: true,
    });

    await server.save();
  }

  // ==================== SYNC METHODS ====================

  async syncAllToDatabase() {
    const interfaces = await this.discoverInterfaces();

    for (const interfaceName of interfaces) {
      try {
        await this.syncInterfaceToDatabase(interfaceName);
      } catch (error) {
        console.error(`Failed to sync ${interfaceName}:`, error.message);
      }
    }

    console.log(`✅ Synced ${interfaces.length} interfaces to database`);
  }

  async syncInterfaceToDatabase(interfaceName) {
    const configPath = path.join(this.configPath, `${interfaceName}.conf`);

    try {
      const configContent = await fs.readFile(configPath, "utf8");
      const config = this.parseConfig(configContent);

      if (!config.interface || !config.interface.PrivateKey) {
        throw new Error(`Invalid config for ${interfaceName}`);
      }

      let server = await Server.findOne({ interfaceName });
      const isRunning = await this.isInterfaceRunning(interfaceName);

      if (server) {
        // Update existing server
        server.address = config.interface.Address || server.address;
        server.listenPort =
          parseInt(config.interface.ListenPort) || server.listenPort;
        server.privateKey = config.interface.PrivateKey;
        server.publicKey = await this.getPublicKey(config.interface.PrivateKey);
        server.mtu = parseInt(config.interface.MTU) || server.mtu;
        server.dns = config.interface.DNS
          ? config.interface.DNS.split(", ").filter((d) => d)
          : server.dns;
        server.status = isRunning ? "active" : "inactive";
        server.lastSync = new Date();
      } else {
        // Create new server
        server = new Server({
          name: interfaceName,
          interfaceName: interfaceName,
          address: config.interface.Address || "10.0.0.1/24",
          listenPort: parseInt(config.interface.ListenPort) || 51820,
          privateKey: config.interface.PrivateKey,
          publicKey: await this.getPublicKey(config.interface.PrivateKey),
          mtu: parseInt(config.interface.MTU) || 1420,
          dns: config.interface.DNS
            ? config.interface.DNS.split(", ").filter((d) => d)
            : ["8.8.8.8", "8.8.4.4"],
          status: isRunning ? "active" : "inactive",
          configPath: this.configPath,
        });
      }

      await server.save();

      // Sync peers
      if (config.peers && config.peers.length > 0) {
        await this.syncPeersToDatabase(server, config.peers);
      }

      return server;
    } catch (error) {
      if (error.code === "ENOENT") {
        // Config file doesn't exist
        console.log(`Config file for ${interfaceName} not found`);
        return null;
      }
      throw error;
    }
  }

  async syncPeersToDatabase(server, peersConfig) {
    for (const peerConfig of peersConfig) {
      if (!peerConfig.PublicKey) continue;

      let peer = await Peer.findOne({
        publicKey: peerConfig.PublicKey,
        server: server._id,
      });

      if (!peer) {
        // Generate private key for new peer
        const privateKey = (await execAsync("wg genkey")).stdout.trim();

        peer = new Peer({
          name: `Peer-${Date.now()}`,
          server: server._id,
          serverId: server.serverId,
          interfaceName: server.interfaceName,
          publicKey: peerConfig.PublicKey,
          privateKey: privateKey,
          allowedIPs: peerConfig.AllowedIPs
            ? peerConfig.AllowedIPs.split(", ").filter((ip) => ip)
            : ["0.0.0.0/0"],
          persistentKeepalive: parseInt(peerConfig.PersistentKeepalive) || 25,
          assignedIP:
            this.extractIPFromAllowedIPs(peerConfig.AllowedIPs) ||
            (await this.generateNextIP(server)),
          status: "pending",
        });
      } else {
        // Update existing peer
        peer.allowedIPs = peerConfig.AllowedIPs
          ? peerConfig.AllowedIPs.split(", ").filter((ip) => ip)
          : peer.allowedIPs;
        peer.persistentKeepalive =
          parseInt(peerConfig.PersistentKeepalive) || peer.persistentKeepalive;
      }

      await peer.save();
    }
  }

  // ==================== MTU TESTING ====================

  async testMTU(interfaceName, testConfig = {}) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error("Server not found");
    }

    const mtuValues = testConfig.mtuValues || [
      1280, 1300, 1320, 1340, 1360, 1380, 1400, 1420, 1440, 1460, 1480, 1500,
    ];

    const testHost = testConfig.testHost || "8.8.8.8";
    const results = [];
    const originalMTU = server.mtu;

    for (const mtu of mtuValues) {
      try {
        // Set temporary MTU
        await this.setTemporaryMTU(interfaceName, mtu);

        // Test connectivity
        const testResult = await this.performMTUTest(
          interfaceName,
          mtu,
          testHost
        );

        results.push({
          mtu,
          success: testResult.success,
          latency: testResult.latency,
          packetLoss: testResult.packetLoss,
          score: this.calculateMTUScore(testResult),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          mtu,
          error: error.message,
          success: false,
          score: 0,
        });
      }
    }

    // Restore original MTU
    if (originalMTU) {
      await this.setTemporaryMTU(interfaceName, originalMTU);
    }

    // Find best MTU
    const validResults = results.filter((r) => r.success);
    const bestResult = validResults.sort((a, b) => b.score - a.score)[0];

    return {
      interface: interfaceName,
      originalMTU,
      bestMTU: bestResult?.mtu || originalMTU,
      results,
      recommendation: this.generateMTURecommendation(
        validResults,
        server.ispProfile
      ),
    };
  }

  async setTemporaryMTU(interfaceName, mtu) {
    try {
      await execAsync(`sudo ip link set ${interfaceName} mtu ${mtu}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    } catch (error) {
      throw new Error(`Failed to set MTU: ${error.message}`);
    }
  }

  async performMTUTest(interfaceName, mtu, testHost) {
    const ping = require("ping");

    const testSizes = [64, 512, mtu - 28];
    const results = {
      pings: [],
      latencies: [],
      packetLoss: 0,
    };

    for (const size of testSizes) {
      try {
        const res = await ping.promise.probe(testHost, {
          timeout: 2,
          interface: interfaceName,
          extra: ["-s", size.toString()],
        });

        results.pings.push({
          size,
          alive: res.alive,
          time: res.time,
        });

        if (res.alive) {
          results.latencies.push(res.time);
        } else {
          results.packetLoss++;
        }
      } catch (error) {
        results.pings.push({
          size,
          alive: false,
          error: error.message,
        });
        results.packetLoss++;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const successfulPings = results.pings.filter((p) => p.alive).length;

    return {
      success: successfulPings > 0,
      latency:
        results.latencies.length > 0
          ? results.latencies.reduce((a, b) => a + b, 0) /
            results.latencies.length
          : 0,
      packetLoss: (results.packetLoss / testSizes.length) * 100,
      successRate: (successfulPings / testSizes.length) * 100,
    };
  }

  calculateMTUScore(testResult) {
    if (!testResult.success) return 0;

    let score = 50; // Base score for successful ping

    // Lower latency is better
    if (testResult.latency < 50) score += 30;
    else if (testResult.latency < 100) score += 20;
    else if (testResult.latency < 200) score += 10;

    // Lower packet loss is better
    score -= testResult.packetLoss;

    return Math.max(0, Math.min(100, score));
  }

  generateMTURecommendation(results, ispProfile) {
    const optimalMTU =
      results.sort((a, b) => b.score - a.score)[0]?.mtu || 1400;

    const recommendations = {
      MPT: {
        optimal: 1400,
        range: "1280-1420",
        notes: "May require lower MTU",
      },
      OOREDOO: { optimal: 1420, range: "1300-1440", notes: "Good MTU support" },
      MYTEL: {
        optimal: 1350,
        range: "1280-1400",
        notes: "Lower MTU recommended",
      },
      ATOM: {
        optimal: 1380,
        range: "1300-1420",
        notes: "Moderate MTU support",
      },
      TELENOR: {
        optimal: 1400,
        range: "1300-1420",
        notes: "Good overall support",
      },
    };

    const ispRec = recommendations[ispProfile] || recommendations.MPT;
    const difference = Math.abs(optimalMTU - ispRec.optimal);

    let advice = "Good";
    if (difference > 100) advice = "Poor";
    else if (difference > 50) advice = "Fair";

    return {
      optimalMTU,
      ispRecommendedMTU: ispRec.optimal,
      difference,
      advice,
      notes: ispRec.notes,
      recommendation:
        difference > 50
          ? `Consider using ${ispRec.optimal} for ${ispProfile}`
          : `Current MTU ${optimalMTU} is optimal`,
    };
  }

  async applyMTUProfile(interfaceName, profileName) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error("Server not found");
    }

    const profile = await MTUProfile.findOne({ name: profileName });
    if (!profile) {
      throw new Error("MTU profile not found");
    }

    const previousMTU = server.mtu;

    // Update server
    server.mtu = profile.mtu;
    server.ispProfile = profile.isp;

    if (profile.dns && profile.dns.length > 0) {
      server.dns = profile.dns;
    }

    if (profile.persistentKeepalive) {
      server.persistentKeepalive = profile.persistentKeepalive;
    }

    await server.save();

    // Update WireGuard interface
    await this.setTemporaryMTU(interfaceName, profile.mtu);

    // Record application
    profile.appliedTo.push({
      server: server._id,
      interfaceName: server.interfaceName,
      appliedAt: new Date(),
      success: true,
      previousMTU: previousMTU,
    });

    await profile.save();

    // Restart interface to apply changes
    await this.restartInterface(interfaceName);

    return {
      success: true,
      message: `Applied MTU profile "${profile.name}" to ${interfaceName}`,
      previousMTU,
      newMTU: profile.mtu,
      server: server.toPublicJSON(),
      profile: {
        name: profile.name,
        mtu: profile.mtu,
        isp: profile.isp,
      },
    };
  }

  // ==================== UTILITY METHODS ====================

  async getPublicKey(privateKey) {
    try {
      const { stdout } = await execAsync(`echo "${privateKey}" | wg pubkey`);
      return stdout.trim();
    } catch (error) {
      throw new Error(`Failed to generate public key: ${error.message}`);
    }
  }

  async isInterfaceRunning(interfaceName) {
    try {
      await execAsync(`wg show ${interfaceName}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  parseConfig(configContent) {
    const lines = configContent.split("\n");
    const result = {
      interface: {},
      peers: [],
    };

    let currentSection = null;
    let currentPeer = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        if (trimmed === "[Interface]") {
          currentSection = "interface";
        } else if (trimmed === "[Peer]") {
          currentPeer = {};
          result.peers.push(currentPeer);
          currentSection = "peer";
        }
        continue;
      }

      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();

        if (currentSection === "interface") {
          result.interface[key.trim()] = value;
        } else if (currentSection === "peer" && currentPeer) {
          currentPeer[key.trim()] = value;
        }
      }
    }

    return result;
  }

  extractIPFromAllowedIPs(allowedIPs) {
    if (!allowedIPs) return null;

    const firstIP = allowedIPs.split(",")[0].trim();
    const match = firstIP.match(/(\d+\.\d+\.\d+\.\d+)\/\d+/);
    return match ? match[1] : null;
  }

  async generateNextIP(server) {
    const peers = await Peer.find({ server: server._id });
    const serverIP = server.address.split("/")[0];
    const serverParts = serverIP.split(".").map(Number);

    for (let i = 2; i <= 254; i++) {
      const candidateIP = `${serverParts[0]}.${serverParts[1]}.${serverParts[2]}.${i}`;

      const isUsed = peers.some((peer) => peer.assignedIP === candidateIP);
      if (!isUsed) {
        return candidateIP;
      }
    }

    throw new Error("No available IP addresses in the subnet");
  }

  // ==================== STATISTICS ====================

  async getStatistics() {
    const [serverStats, peerStats, interfaceCount] = await Promise.all([
      Server.getStatistics(),
      Peer.getStatistics(),
      this.discoverInterfaces(),
    ]);

    return {
      servers: {
        total: serverStats.totalServers || 0,
        active: serverStats.activeServers || 0,
        inactive:
          (serverStats.totalServers || 0) - (serverStats.activeServers || 0),
        byISP: serverStats.ispDistribution || {},
      },
      peers: {
        total: peerStats.totalPeers || 0,
        connected: peerStats.connectedPeers || 0,
        byISP: peerStats.ispDistribution || {},
        byStatus: peerStats.statusDistribution || {},
      },
      data: {
        received: serverStats.totalDataReceived || 0,
        sent: serverStats.totalDataSent || 0,
        total:
          (serverStats.totalDataReceived || 0) +
          (serverStats.totalDataSent || 0),
      },
      interfaces: {
        discovered: interfaceCount.length,
        configured: serverStats.totalServers || 0,
      },
      uptime: {
        average: serverStats.avgUptime || 0,
      },
    };
  }

  // ==================== BACKUP & RESTORE ====================

  async backupConfig(interfaceName) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error("Server not found");
    }

    const configPath = path.join(this.configPath, `${interfaceName}.conf`);
    const configContent = await fs.readFile(configPath, "utf8");

    const backup = {
      server: server.toPublicJSON(),
      config: configContent,
      peers: await Peer.find({ server: server._id }).select(
        "-privateKey -presharedKey"
      ),
      timestamp: new Date().toISOString(),
      version: "1.0",
    };

    // Create backup directory
    const backupDir = path.join(this.configPath, "backups");
    await fs.mkdir(backupDir, { recursive: true });

    // Save backup
    const backupFile = path.join(
      backupDir,
      `${interfaceName}_${Date.now()}.json`
    );
    await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), "utf8");

    return {
      success: true,
      message: "Backup created successfully",
      backupFile: backupFile,
      backup: backup,
    };
  }

  async restoreConfig(backupFile) {
    const backupContent = await fs.readFile(backupFile, "utf8");
    const backup = JSON.parse(backupContent);

    if (!backup.server || !backup.config) {
      throw new Error("Invalid backup file");
    }

    const { server: serverData, config: configContent } = backup;

    // Check if interface already exists
    const existing = await Server.findOne({
      interfaceName: serverData.interfaceName,
    });

    if (existing) {
      throw new Error(`Interface ${serverData.interfaceName} already exists`);
    }

    // Create server
    const server = new Server({
      ...serverData,
      status: "inactive",
    });
    await server.save();

    // Save config file
    const configPath = path.join(
      this.configPath,
      `${server.interfaceName}.conf`
    );
    await fs.writeFile(configPath, configContent, "utf8");
    await fs.chmod(configPath, 0o600);

    // Restore peers
    if (backup.peers && Array.isArray(backup.peers)) {
      for (const peerData of backup.peers) {
        const peer = new Peer({
          ...peerData,
          server: server._id,
          serverId: server.serverId,
          status: "pending",
        });
        await peer.save();
      }
    }

    return {
      success: true,
      message: "Config restored successfully",
      server: server.toPublicJSON(),
      peersRestored: backup.peers?.length || 0,
    };
  }

  // ==================== BULK OPERATIONS ====================

  async bulkApplyISPProfile(ispProfile) {
    const servers = await Server.find({});
    const results = [];

    for (const server of servers) {
      try {
        const result = await this.applyISPProfile(
          server.interfaceName,
          ispProfile
        );
        results.push({
          server: server.interfaceName,
          success: true,
          result: result,
        });
      } catch (error) {
        results.push({
          server: server.interfaceName,
          success: false,
          error: error.message,
        });
      }
    }

    return {
      total: servers.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results: results,
    };
  }

  async applyISPProfile(interfaceName, ispProfile) {
    const server = await Server.findOne({ interfaceName });
    if (!server) {
      throw new Error("Server not found");
    }

    const profile = this.ispProfiles[ispProfile];
    if (!profile) {
      throw new Error(`ISP profile ${ispProfile} not found`);
    }

    // Update server
    server.ispProfile = ispProfile;
    server.mtu = profile.mtu;
    server.dns = profile.dns;
    server.persistentKeepalive = profile.persistentKeepalive;

    await server.save();

    // Update config file
    const configPath = path.join(this.configPath, `${interfaceName}.conf`);
    let configContent = await fs.readFile(configPath, "utf8");

    // Update MTU in config
    configContent = this.updateConfigValue(configContent, "MTU", profile.mtu);

    // Update DNS in config
    if (profile.dns && profile.dns.length > 0) {
      configContent = this.updateConfigValue(
        configContent,
        "DNS",
        profile.dns.join(", ")
      );
    }

    await fs.writeFile(configPath, configContent, "utf8");

    // Restart interface
    await this.restartInterface(interfaceName);

    return {
      success: true,
      message: `Applied ${ispProfile} profile to ${interfaceName}`,
      server: server.toPublicJSON(),
      profile: profile,
    };
  }

  updateConfigValue(configContent, key, value) {
    const lines = configContent.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${key} =`)) {
        lines[i] = `${key} = ${value}`;
        found = true;
        break;
      }
    }

    if (!found) {
      // Add after [Interface] section
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "[Interface]") {
          lines.splice(i + 1, 0, `${key} = ${value}`);
          break;
        }
      }
    }

    return lines.join("\n");
  }

  // ==================== HEALTH CHECK ====================

  async healthCheck() {
    const health = {
      database: false,
      wireguard: false,
      interfaces: [],
      timestamp: new Date().toISOString(),
    };

    // Check database connection
    try {
      const mongoose = require("mongoose");
      health.database = mongoose.connection.readyState === 1;
    } catch (error) {
      health.database = false;
      health.databaseError = error.message;
    }

    // Check WireGuard installation
    try {
      await execAsync("wg --version");
      health.wireguard = true;
    } catch (error) {
      health.wireguard = false;
      health.wireguardError = error.message;
    }

    // Check interfaces
    const interfaces = await this.discoverInterfaces();
    for (const iface of interfaces) {
      const isRunning = await this.isInterfaceRunning(iface);
      health.interfaces.push({
        name: iface,
        running: isRunning,
        configExists: await this.configExists(iface),
      });
    }

    // Overall status
    health.status =
      health.database && health.wireguard ? "healthy" : "unhealthy";
    health.score = this.calculateHealthScore(health);

    return health;
  }

  async configExists(interfaceName) {
    try {
      const configPath = path.join(this.configPath, `${interfaceName}.conf`);
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  calculateHealthScore(health) {
    let score = 0;
    if (health.database) score += 40;
    if (health.wireguard) score += 30;

    const runningInterfaces = health.interfaces.filter((i) => i.running).length;
    const totalInterfaces = health.interfaces.length;

    if (totalInterfaces > 0) {
      score += (runningInterfaces / totalInterfaces) * 30;
    }

    return Math.round(score);
  }
}

// Create singleton instance
const wireguardService = new DatabaseWireGuardService();

// Initialize on module load
wireguardService.initialize().catch(console.error);

module.exports = wireguardService;
