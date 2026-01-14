const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");

const PeerSchema = new mongoose.Schema(
  {
    peerId: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Peer name is required"],
      trim: true,
      minlength: [2, "Peer name must be at least 2 characters"],
      maxlength: [100, "Peer name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Server reference is required"],
      index: true,
    },
    serverId: {
      type: String,
      required: true,
    },
    interfaceName: {
      type: String,
      required: true,
    },
    publicKey: {
      type: String,
      required: [true, "Public key is required"],
      unique: true,
      index: true,
    },
    privateKey: {
      type: String,
      required: [true, "Private key is required"],
      select: false,
    },
    presharedKey: {
      type: String,
      select: false,
    },
    allowedIPs: [
      {
        type: String,
        required: [true, "At least one allowed IP is required"],
        match: [/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "Invalid CIDR notation"],
      },
    ],
    endpoint: {
      host: String,
      port: {
        type: Number,
        min: [1, "Port must be at least 1"],
        max: [65535, "Port cannot exceed 65535"],
      },
    },
    persistentKeepalive: {
      type: Number,
      default: 25,
      min: [0, "Keepalive cannot be negative"],
      max: [300, "Keepalive cannot exceed 300 seconds"],
    },
    assignedIP: {
      type: String,
      required: [true, "Assigned IP is required"],
      match: [/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"],
    },
    dns: [
      {
        type: String,
        validate: {
          validator: function (v) {
            return /^(\d{1,3}\.){3}\d{1,3}$/.test(v);
          },
          message: "Invalid IP address format",
        },
      },
    ],
    mtu: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ["connected", "disconnected", "pending", "error", "disabled"],
      default: "pending",
    },
    lastHandshake: Date,
    lastSeen: Date,
    firstSeen: Date,
    connectionCount: {
      type: Number,
      default: 0,
    },
    totalUptime: {
      type: Number,
      default: 0,
    },
    dataTransferred: {
      received: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
    },
    transferRate: {
      download: { type: Number, default: 0 },
      upload: { type: Number, default: 0 },
    },
    clientInfo: {
      deviceName: String,
      platform: String,
      os: String,
      appVersion: String,
      clientType: {
        type: String,
        enum: ["desktop", "mobile", "server", "router", "other"],
        default: "other",
      },
    },
    isp: {
      name: String,
      type: {
        type: String,
        enum: [
          "MPT",
          "OOREDOO",
          "MYTEL",
          "ATOM",
          "TELENOR",
          "OTHER",
          "UNKNOWN",
        ],
        default: "UNKNOWN",
      },
      country: {
        type: String,
        default: "MM",
      },
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    accessLevel: {
      type: String,
      enum: ["full", "restricted", "guest"],
      default: "guest",
    },
    bandwidthLimit: {
      download: { type: Number, default: 0 },
      upload: { type: Number, default: 0 },
    },
    dataLimit: {
      monthly: { type: Number, default: 0 },
      used: { type: Number, default: 0 },
      resetDate: { type: Date, default: Date.now },
    },
    usePresharedKey: {
      type: Boolean,
      default: false,
    },
    allowLocalNetwork: {
      type: Boolean,
      default: false,
    },
    allowInternet: {
      type: Boolean,
      default: true,
    },
    configGenerated: {
      type: Boolean,
      default: false,
    },
    qrCode: String,
    configFile: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    notes: {
      type: String,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },
    keyRotationDate: {
      type: Date,
      default: Date.now,
    },
    expiresAt: Date,
    lastKeyRotation: Date,
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals
PeerSchema.virtual("connectionDuration").get(function () {
  if (!this.lastHandshake) return 0;
  const now = new Date();
  return Math.floor((now - this.lastHandshake) / 1000);
});

PeerSchema.virtual("isExpired").get(function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

PeerSchema.virtual("needsKeyRotation").get(function () {
  if (!this.keyRotationDate) return false;
  const rotationDate = new Date(this.keyRotationDate);
  rotationDate.setDate(rotationDate.getDate() + 30);
  return new Date() > rotationDate;
});

PeerSchema.virtual("totalData").get(function () {
  return this.dataTransferred.received + this.dataTransferred.sent;
});

PeerSchema.virtual("dataLimitPercentage").get(function () {
  if (this.dataLimit.monthly === 0) return 0;
  return (this.dataLimit.used / this.dataLimit.monthly) * 100;
});

PeerSchema.virtual("isConnected").get(function () {
  return this.status === "connected";
});

// Indexes
PeerSchema.index({ publicKey: 1 });
PeerSchema.index({ server: 1, status: 1 });
PeerSchema.index({ "endpoint.host": 1 });
PeerSchema.index({ status: 1 });
PeerSchema.index({ enabled: 1 });
PeerSchema.index({ "isp.type": 1 });
PeerSchema.index({ createdAt: -1 });
PeerSchema.index({ "dataTransferred.received": -1 });
PeerSchema.index({ tags: 1 });
PeerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Middleware
PeerSchema.pre("save", async function (next) {
  this.updatedAt = Date.now();

  if (this.server && this.server._id) {
    this.serverId = this.server.serverId || this.server._id.toString();
  }

  if (
    this.isModified("status") &&
    this.status === "connected" &&
    !this.firstSeen
  ) {
    this.firstSeen = new Date();
  }

  if (this.isModified("status") && this.status === "connected") {
    this.lastSeen = new Date();
    this.connectionCount += 1;
  }

  if (
    this.isModified("status") &&
    this.status === "disconnected" &&
    this.lastHandshake
  ) {
    const uptime = (new Date() - this.lastHandshake) / 1000;
    this.totalUptime += uptime;
  }

  if (!this.mtu && this.server) {
    const Server = mongoose.model("Server");
    const server = await Server.findById(this.server).select("mtu");
    if (server) {
      this.mtu = server.mtu;
    }
  }

  if (!this.keyRotationDate) {
    this.keyRotationDate = new Date();
  }

  next();
});

PeerSchema.post("save", async function (doc) {
  const Server = mongoose.model("Server");
  const Peer = mongoose.model("Peer");

  const peerCount = await Peer.countDocuments({
    server: doc.server,
    enabled: true,
  });

  const activePeers = await Peer.countDocuments({
    server: doc.server,
    status: "connected",
    enabled: true,
  });

  await Server.findByIdAndUpdate(doc.server, {
    peerCount,
    activePeers,
  });
});

PeerSchema.pre("remove", async function (next) {
  const Server = mongoose.model("Server");
  await Server.findByIdAndUpdate(this.server, { $inc: { peerCount: -1 } });
  next();
});

// Instance Methods
PeerSchema.methods.generateConfig = async function () {
  const Server = mongoose.model("Server");
  const server = await Server.findById(this.server);

  if (!server) {
    throw new Error("Server not found");
  }

  const config = [];
  config.push("[Interface]");
  config.push(`PrivateKey = ${this.privateKey}`);
  config.push(`Address = ${this.assignedIP}/32`);

  if (this.dns && this.dns.length > 0) {
    config.push(`DNS = ${this.dns.join(", ")}`);
  } else if (server.dns && server.dns.length > 0) {
    config.push(`DNS = ${server.dns.join(", ")}`);
  }

  if (this.mtu) {
    config.push(`MTU = ${this.mtu}`);
  } else if (server.mtu) {
    config.push(`MTU = ${server.mtu}`);
  }

  config.push("");
  config.push("[Peer]");
  config.push(`PublicKey = ${server.publicKey}`);

  if (server.listenPort) {
    const endpointHost = this.endpoint?.host || server.address.split("/")[0];
    config.push(`Endpoint = ${endpointHost}:${server.listenPort}`);
  }

  config.push(`AllowedIPs = ${this.allowedIPs.join(", ")}`);

  if (this.persistentKeepalive) {
    config.push(`PersistentKeepalive = ${this.persistentKeepalive}`);
  }

  if (this.presharedKey && this.usePresharedKey) {
    config.push(`PresharedKey = ${this.presharedKey}`);
  }

  const configContent = config.join("\n");
  this.configFile = configContent;
  this.configGenerated = true;

  // Generate QR code
  try {
    this.qrCode = await QRCode.toDataURL(configContent);
  } catch (error) {
    console.error("Failed to generate QR code:", error);
  }

  await this.save();
  return configContent;
};

PeerSchema.methods.updateTransferStats = function (received, sent) {
  this.dataTransferred.received += received;
  this.dataTransferred.sent += sent;

  // Update data limit usage
  if (this.dataLimit.monthly > 0) {
    this.dataLimit.used += received + sent;
  }

  return this.save();
};

PeerSchema.methods.resetDataLimit = function () {
  this.dataLimit.used = 0;
  this.dataLimit.resetDate = new Date();
  return this.save();
};

PeerSchema.methods.rotateKeys = async function () {
  const { exec } = require("child_process");
  const util = require("util");
  const execAsync = util.promisify(exec);

  const privateKey = (await execAsync("wg genkey")).stdout.trim();
  const publicKey = (
    await execAsync(`echo "${privateKey}" | wg pubkey`)
  ).stdout.trim();

  this.privateKey = privateKey;
  this.publicKey = publicKey;
  this.lastKeyRotation = new Date();
  this.keyRotationDate = new Date();
  this.configGenerated = false;
  this.qrCode = null;

  await this.save();
  return this;
};

PeerSchema.methods.toClientJSON = function () {
  const obj = this.toObject();

  delete obj.privateKey;
  delete obj.presharedKey;
  delete obj._id;
  delete obj.__v;

  obj.connectionDuration = this.connectionDuration;
  obj.isExpired = this.isExpired;
  obj.totalData = this.totalData;
  obj.dataLimitPercentage = this.dataLimitPercentage;
  obj.isConnected = this.isConnected;

  return obj;
};

PeerSchema.methods.toConfigJSON = function () {
  return {
    peerId: this.peerId,
    name: this.name,
    publicKey: this.publicKey,
    assignedIP: this.assignedIP,
    allowedIPs: this.allowedIPs,
    dns: this.dns,
    mtu: this.mtu,
    persistentKeepalive: this.persistentKeepalive,
    status: this.status,
    enabled: this.enabled,
    createdAt: this.createdAt,
    configFile: this.configFile,
    qrCode: this.qrCode,
  };
};

// Static Methods
PeerSchema.statics.findByServer = function (serverId) {
  return this.find({ server: serverId })
    .populate("server", "name interfaceName publicKey listenPort address")
    .sort({ createdAt: -1 });
};

PeerSchema.statics.findConnected = function () {
  return this.find({ status: "connected", enabled: true }).populate(
    "server",
    "name interfaceName"
  );
};

PeerSchema.statics.findByISP = function (ispType) {
  return this.find({ "isp.type": ispType }).populate("server");
};

PeerSchema.statics.getStatistics = async function (serverId = null) {
  const matchStage = serverId
    ? { server: mongoose.Types.ObjectId(serverId) }
    : {};

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalPeers: { $sum: 1 },
        connectedPeers: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "connected"] },
                  { $eq: ["$enabled", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalDataReceived: { $sum: "$dataTransferred.received" },
        totalDataSent: { $sum: "$dataTransferred.sent" },
        byISP: {
          $push: {
            isp: "$isp.type",
            count: 1,
          },
        },
        byStatus: {
          $push: {
            status: "$status",
            count: 1,
          },
        },
      },
    },
    {
      $project: {
        totalPeers: 1,
        connectedPeers: 1,
        totalDataReceived: 1,
        totalDataSent: 1,
        ispDistribution: {
          $arrayToObject: {
            $map: {
              input: "$byISP",
              as: "item",
              in: {
                k: "$$item.isp",
                v: "$$item.count",
              },
            },
          },
        },
        statusDistribution: {
          $arrayToObject: {
            $map: {
              input: "$byStatus",
              as: "item",
              in: {
                k: "$$item.status",
                v: "$$item.count",
              },
            },
          },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalPeers: 0,
      connectedPeers: 0,
      totalDataReceived: 0,
      totalDataSent: 0,
      ispDistribution: {},
      statusDistribution: {},
    }
  );
};

PeerSchema.statics.generateNewPeer = async function (serverId, peerData = {}) {
  const Server = mongoose.model("Server");
  const server = await Server.findById(serverId);

  if (!server) {
    throw new Error("Server not found");
  }

  const { exec } = require("child_process");
  const util = require("util");
  const execAsync = util.promisify(exec);

  // Generate keys
  const privateKey = (await execAsync("wg genkey")).stdout.trim();
  const publicKey = (
    await execAsync(`echo "${privateKey}" | wg pubkey`)
  ).stdout.trim();

  // Generate preshared key if requested
  let presharedKey = null;
  if (peerData.usePresharedKey) {
    presharedKey = (await execAsync("wg genpsk")).stdout.trim();
  }

  // Determine assigned IP
  const assignedIP =
    peerData.assignedIP || (await this._getNextAvailableIP(server));

  const peer = new this({
    ...peerData,
    server: server._id,
    serverId: server.serverId,
    interfaceName: server.interfaceName,
    privateKey,
    publicKey,
    presharedKey,
    assignedIP,
    allowedIPs: peerData.allowedIPs || ["0.0.0.0/0"],
    mtu: peerData.mtu || server.mtu,
    dns: peerData.dns || server.dns,
    isp: {
      type: peerData.ispType || "UNKNOWN",
      country: "MM",
    },
  });

  await peer.save();
  return peer;
};

PeerSchema.statics._getNextAvailableIP = async function (server) {
  // Get all peers for this server
  const peers = await this.find({ server: server._id });

  // Parse server network
  const serverIP = server.address.split("/")[0];
  const serverParts = serverIP.split(".").map(Number);

  // Find next available IP in the subnet (starting from .2)
  for (let i = 2; i <= 254; i++) {
    const candidateIP = `${serverParts[0]}.${serverParts[1]}.${serverParts[2]}.${i}`;

    const isUsed = peers.some((peer) => peer.assignedIP === candidateIP);
    if (!isUsed) {
      return candidateIP;
    }
  }

  throw new Error("No available IP addresses in the subnet");
};

const Peer = mongoose.model("Peer", PeerSchema);
module.exports = Peer;
