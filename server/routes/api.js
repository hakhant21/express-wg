const express = require("express");
const router = express.Router();
const wireguard = require("../wireguard");
const Server = require("../models/Server");
const Peer = require("../models/Peer");
const MTUProfile = require("../models/MTUProfile");

// ==================== HEALTH & STATUS ====================

router.get("/health", async (req, res) => {
  try {
    const health = await wireguard.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const stats = await wireguard.getStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVER MANAGEMENT ====================

router.get("/servers", async (req, res) => {
  try {
    const servers = await Server.find({})
      .select("-privateKey")
      .sort({ createdAt: -1 })
      .populate("peers");
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/servers/:id", async (req, res) => {
  try {
    const server = await Server.findById(req.params.id)
      .select("-privateKey")
      .populate("peers");

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    res.json(server);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers", async (req, res) => {
  try {
    const result = await wireguard.createInterface(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put("/servers/:id", async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    Object.assign(server, req.body);
    await server.save();

    // Update config file
    const configPath = `${server.configPath}/${server.interfaceName}.conf`;
    const configContent = server.getConfigContent();
    await require("fs").promises.writeFile(configPath, configContent, "utf8");

    res.json({
      success: true,
      message: "Server updated successfully",
      server: server.toPublicJSON(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/servers/:id", async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const result = await wireguard.deleteInterface(server.interfaceName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers/:interfaceName/start", async (req, res) => {
  try {
    const result = await wireguard.startInterface(req.params.interfaceName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers/:interfaceName/stop", async (req, res) => {
  try {
    const result = await wireguard.stopInterface(req.params.interfaceName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers/:interfaceName/restart", async (req, res) => {
  try {
    const result = await wireguard.restartInterface(req.params.interfaceName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers/:interfaceName/sync", async (req, res) => {
  try {
    const server = await wireguard.syncInterfaceToDatabase(
      req.params.interfaceName
    );
    if (!server) {
      return res.status(404).json({ error: "Interface not found" });
    }
    res.json({
      success: true,
      message: "Interface synced to database",
      server: server.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PEER MANAGEMENT ====================

router.get("/peers", async (req, res) => {
  try {
    const { server, status, isp } = req.query;
    const query = {};

    if (server) query.server = server;
    if (status) query.status = status;
    if (isp) query["isp.type"] = isp;

    const peers = await Peer.find(query)
      .select("-privateKey -presharedKey")
      .populate("server", "name interfaceName")
      .sort({ createdAt: -1 });

    res.json(peers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/peers/:id", async (req, res) => {
  try {
    const peer = await Peer.findById(req.params.id)
      .select("-privateKey -presharedKey")
      .populate("server");

    if (!peer) {
      return res.status(404).json({ error: "Peer not found" });
    }

    res.json(peer.toClientJSON());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/peers", async (req, res) => {
  try {
    const result = await wireguard.addPeer(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put("/peers/:id", async (req, res) => {
  try {
    const peer = await Peer.findById(req.params.id);
    if (!peer) {
      return res.status(404).json({ error: "Peer not found" });
    }

    Object.assign(peer, req.body);
    await peer.save();

    // Regenerate config if keys changed
    if (req.body.privateKey || req.body.allowedIPs) {
      await peer.generateConfig();
    }

    res.json({
      success: true,
      message: "Peer updated successfully",
      peer: peer.toClientJSON(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/peers/:id", async (req, res) => {
  try {
    const result = await wireguard.removePeer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/peers/:id/enable", async (req, res) => {
  try {
    const result = await wireguard.enablePeer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/peers/:id/disable", async (req, res) => {
  try {
    const result = await wireguard.disablePeer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/peers/:id/rotate-keys", async (req, res) => {
  try {
    const peer = await Peer.findById(req.params.id);
    if (!peer) {
      return res.status(404).json({ error: "Peer not found" });
    }

    const updatedPeer = await peer.rotateKeys();

    // Update WireGuard interface
    const server = await Server.findById(peer.server);
    await require("child_process").execAsync(
      `wg set ${server.interfaceName} peer ${peer.publicKey} remove`
    );
    await require("child_process").execAsync(
      `wg set ${server.interfaceName} peer ${
        updatedPeer.publicKey
      } allowed-ips ${updatedPeer.allowedIPs.join(",")}`
    );
    await require("child_process").execAsync(
      `wg-quick save ${server.interfaceName}`
    );

    res.json({
      success: true,
      message: "Keys rotated successfully",
      peer: updatedPeer.toClientJSON(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/peers/:id/config", async (req, res) => {
  try {
    const peer = await Peer.findById(req.params.id);
    if (!peer) {
      return res.status(404).json({ error: "Peer not found" });
    }

    if (!peer.configGenerated) {
      await peer.generateConfig();
    }

    res.json({
      config: peer.configFile,
      qrCode: peer.qrCode,
      peer: peer.toConfigJSON(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MTU TESTING & PROFILES ====================

router.post("/mtu/test", async (req, res) => {
  try {
    const { interfaceName, mtuValues, testHost } = req.body;
    const result = await wireguard.testMTU(interfaceName, {
      mtuValues,
      testHost,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/mtu/profiles", async (req, res) => {
  try {
    const { isp, isDefault } = req.query;
    const query = {};

    if (isp) query.isp = isp;
    if (isDefault === "true") query.isDefault = true;

    const profiles = await MTUProfile.find(query).sort({ mtu: 1 });
    res.json(profiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/mtu/profiles/:id", async (req, res) => {
  try {
    const profile = await MTUProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mtu/profiles", async (req, res) => {
  try {
    const profile = new MTUProfile(req.body);
    await profile.save();
    res.status(201).json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put("/mtu/profiles/:id", async (req, res) => {
  try {
    const profile = await MTUProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    Object.assign(profile, req.body);
    await profile.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      profile,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/mtu/profiles/:id", async (req, res) => {
  try {
    await MTUProfile.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Profile deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mtu/profiles/:id/apply", async (req, res) => {
  try {
    const { interfaceName } = req.body;
    const result = await wireguard.applyMTUProfile(
      interfaceName,
      req.params.id
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mtu/profiles/:id/test", async (req, res) => {
  try {
    const { testHost } = req.body;
    const profile = await MTUProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const result = await profile.runTest(testHost);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/mtu/isp-profiles", async (req, res) => {
  try {
    const ispProfiles = require("../config/isp-profiles.json");
    res.json(ispProfiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/servers/:interfaceName/apply-isp", async (req, res) => {
  try {
    const { ispProfile } = req.body;
    const result = await wireguard.applyISPProfile(
      req.params.interfaceName,
      ispProfile
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BACKUP & RESTORE ====================

router.post("/backup/:interfaceName", async (req, res) => {
  try {
    const result = await wireguard.backupConfig(req.params.interfaceName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/restore", async (req, res) => {
  try {
    const { backupFile } = req.body;
    const result = await wireguard.restoreConfig(backupFile);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BULK OPERATIONS ====================

router.post("/bulk/apply-isp", async (req, res) => {
  try {
    const { ispProfile } = req.body;
    const result = await wireguard.bulkApplyISPProfile(ispProfile);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/sync-all", async (req, res) => {
  try {
    await wireguard.syncAllToDatabase();
    res.json({ success: true, message: "All interfaces synced to database" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== UTILITIES ====================

router.get("/interfaces", async (req, res) => {
  try {
    const interfaces = await wireguard.discoverInterfaces();
    const servers = await Server.find({ interfaceName: { $in: interfaces } });

    const result = interfaces.map((iface) => {
      const server = servers.find((s) => s.interfaceName === iface);
      return {
        name: iface,
        configured: !!server,
        server: server ? server.toPublicJSON() : null,
        running: server ? server.status === "active" : false,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/generate-keys", async (req, res) => {
  try {
    const { exec } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);

    const privateKey = (await execAsync("wg genkey")).stdout.trim();
    const publicKey = (
      await execAsync(`echo "${privateKey}" | wg pubkey`)
    ).stdout.trim();
    const presharedKey = (await execAsync("wg genpsk")).stdout.trim();

    res.json({
      privateKey,
      publicKey,
      presharedKey,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SEARCH & FILTER ====================

router.get("/search", async (req, res) => {
  try {
    const { q, type } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Search query required" });
    }

    let results = [];

    if (!type || type === "servers") {
      const servers = await Server.find({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { interfaceName: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
          { tags: { $regex: q, $options: "i" } },
        ],
      })
        .select("-privateKey")
        .limit(10);

      results = results.concat(
        servers.map((s) => ({
          type: "server",
          data: s.toPublicJSON(),
          score: 1,
        }))
      );
    }

    if (!type || type === "peers") {
      const peers = await Peer.find({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { publicKey: { $regex: q, $options: "i" } },
          { assignedIP: { $regex: q, $options: "i" } },
          { "clientInfo.deviceName": { $regex: q, $options: "i" } },
          { tags: { $regex: q, $options: "i" } },
        ],
      })
        .select("-privateKey -presharedKey")
        .populate("server")
        .limit(10);

      results = results.concat(
        peers.map((p) => ({
          type: "peer",
          data: p.toClientJSON(),
          score: 1,
        }))
      );
    }

    res.json({
      query: q,
      count: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
