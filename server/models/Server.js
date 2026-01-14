const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const ServerSchema = new mongoose.Schema(
  {
    serverId: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Server name is required"],
      trim: true,
      minlength: [2, "Server name must be at least 2 characters"],
      maxlength: [100, "Server name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    interfaceName: {
      type: String,
      required: [true, "Interface name is required"],
      match: [/^wg\d+$/, "Interface name must be in format wg0, wg1, etc."],
      default: "wg0",
      unique: true,
    },
    configPath: {
      type: String,
      required: true,
      default: "/etc/wireguard",
    },
    listenPort: {
      type: Number,
      required: true,
      default: 51820,
      min: [1024, "Port must be at least 1024"],
      max: [65535, "Port cannot exceed 65535"],
    },
    address: {
      type: String,
      required: [true, "Server address is required"],
      match: [/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "Invalid CIDR notation"],
    },
    privateKey: {
      type: String,
      required: [true, "Private key is required"],
      select: false,
    },
    publicKey: {
      type: String,
      required: [true, "Public key is required"],
    },
    ispProfile: {
      type: String,
      enum: ["MPT", "OOREDOO", "MYTEL", "ATOM", "TELENOR", "CUSTOM", "UNKNOWN"],
      default: "UNKNOWN",
    },
    mtu: {
      type: Number,
      default: 1420,
      min: [576, "MTU cannot be less than 576"],
      max: [9000, "MTU cannot exceed 9000"],
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
    persistentKeepalive: {
      type: Number,
      default: 25,
      min: [0, "Keepalive cannot be negative"],
      max: [300, "Keepalive cannot exceed 300 seconds"],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "error", "maintenance"],
      default: "inactive",
    },
    lastStartTime: Date,
    lastStopTime: Date,
    totalUptime: {
      type: Number,
      default: 0,
    },
    totalDataTransferred: {
      received: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
    },
    peerCount: {
      type: Number,
      default: 0,
      min: [0, "Peer count cannot be negative"],
    },
    activePeers: {
      type: Number,
      default: 0,
      min: [0, "Active peers cannot be negative"],
    },
    enableIPv6: {
      type: Boolean,
      default: false,
    },
    enableRouting: {
      type: Boolean,
      default: true,
    },
    enableNAT: {
      type: Boolean,
      default: true,
    },
    saveConfig: {
      type: Boolean,
      default: true,
    },
    allowedIPs: [
      {
        type: String,
        match: [/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "Invalid CIDR notation"],
      },
    ],
    blockedIPs: [
      {
        type: String,
        match: [/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "Invalid CIDR notation"],
      },
    ],
    monitoring: {
      enabled: { type: Boolean, default: true },
      checkInterval: { type: Number, default: 60 },
      alertThreshold: { type: Number, default: 90 },
    },
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    lastSync: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals
ServerSchema.virtual("uptimePercentage").get(function () {
  if (!this.lastStartTime) return 0;
  const now = new Date();
  const uptime = (now - this.lastStartTime) / 1000;
  const totalTime = this.totalUptime + uptime;
  const daysRunning = (now - this.createdAt) / (1000 * 60 * 60 * 24);
  return daysRunning > 0 ? (totalTime / (daysRunning * 86400)) * 100 : 0;
});

ServerSchema.virtual("dataTransferredTotal").get(function () {
  return this.totalDataTransferred.received + this.totalDataTransferred.sent;
});

ServerSchema.virtual("configFile").get(function () {
  return `${this.configPath}/${this.interfaceName}.conf`;
});

ServerSchema.virtual("peers", {
  ref: "Peer",
  localField: "_id",
  foreignField: "server",
});

// Indexes
ServerSchema.index({ interfaceName: 1 }, { unique: true });
ServerSchema.index({ status: 1 });
ServerSchema.index({ ispProfile: 1 });
ServerSchema.index({ createdAt: -1 });
ServerSchema.index({ "totalDataTransferred.sent": -1 });
ServerSchema.index({ tags: 1 });

// Middleware
ServerSchema.pre("save", function (next) {
  this.updatedAt = Date.now();

  if (
    this.isModified("address") ||
    this.isModified("listenPort") ||
    this.isModified("privateKey")
  ) {
    this.lastSync = Date.now();
  }

  next();
});

ServerSchema.pre("save", async function (next) {
  if (this.dns && this.dns.length === 0) {
    this.dns = ["8.8.8.8", "8.8.4.4"];
  }
  next();
});

// Instance Methods
ServerSchema.methods.getConfigContent = function () {
  const config = [];

  config.push("[Interface]");
  config.push(`Address = ${this.address}`);
  config.push(`ListenPort = ${this.listenPort}`);
  config.push(`PrivateKey = ${this.privateKey}`);

  if (this.mtu) {
    config.push(`MTU = ${this.mtu}`);
  }

  if (this.dns && this.dns.length > 0) {
    config.push(`DNS = ${this.dns.join(", ")}`);
  }

  if (!this.enableIPv6) {
    config.push("DisableIPv6 = true");
  }

  config.push("");

  return config.join("\n");
};

ServerSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();

  delete obj.privateKey;
  delete obj._id;
  delete obj.__v;

  return obj;
};

ServerSchema.methods.updateStatus = async function (newStatus) {
  const now = new Date();

  if (this.status === "active" && newStatus === "inactive") {
    if (this.lastStartTime) {
      const uptime = (now - this.lastStartTime) / 1000;
      this.totalUptime += uptime;
    }
    this.lastStopTime = now;
  } else if (this.status === "inactive" && newStatus === "active") {
    this.lastStartTime = now;
  }

  this.status = newStatus;
  return this.save();
};

ServerSchema.methods.addAllowedIP = function (ip) {
  if (!this.allowedIPs.includes(ip)) {
    this.allowedIPs.push(ip);
  }
  return this.save();
};

ServerSchema.methods.removeAllowedIP = function (ip) {
  this.allowedIPs = this.allowedIPs.filter((allowedIP) => allowedIP !== ip);
  return this.save();
};

// Static Methods
ServerSchema.statics.findActiveServers = function () {
  return this.find({ status: "active" });
};

ServerSchema.statics.findByISP = function (isp) {
  return this.find({ ispProfile: isp });
};

ServerSchema.statics.getStatistics = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalServers: { $sum: 1 },
        activeServers: {
          $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
        },
        totalPeers: { $sum: "$peerCount" },
        activePeers: { $sum: "$activePeers" },
        totalDataReceived: { $sum: "$totalDataTransferred.received" },
        totalDataSent: { $sum: "$totalDataTransferred.sent" },
        avgUptime: { $avg: "$totalUptime" },
        byISP: {
          $push: {
            isp: "$ispProfile",
            count: 1,
          },
        },
      },
    },
    {
      $project: {
        totalServers: 1,
        activeServers: 1,
        totalPeers: 1,
        activePeers: 1,
        totalDataReceived: 1,
        totalDataSent: 1,
        avgUptime: 1,
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
      },
    },
  ]);

  return (
    stats[0] || {
      totalServers: 0,
      activeServers: 0,
      totalPeers: 0,
      activePeers: 0,
      totalDataReceived: 0,
      totalDataSent: 0,
      avgUptime: 0,
      ispDistribution: {},
    }
  );
};

ServerSchema.statics.createFromConfig = async function (
  configPath,
  interfaceName = "wg0"
) {
  const fs = require("fs").promises;
  const path = require("path");
  const { exec } = require("child_process");
  const util = require("util");
  const execAsync = util.promisify(exec);

  const fullPath = path.join(configPath, `${interfaceName}.conf`);
  const configContent = await fs.readFile(fullPath, "utf8");

  const lines = configContent.split("\n");
  const interfaceData = {};
  let inInterface = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "[Interface]") {
      inInterface = true;
      continue;
    } else if (trimmed.startsWith("[")) {
      inInterface = false;
      continue;
    }

    if (inInterface && trimmed) {
      const [key, value] = trimmed.split("=").map((s) => s.trim());
      if (key && value) {
        interfaceData[key] = value;
      }
    }
  }

  if (!interfaceData.PrivateKey) {
    throw new Error("No private key found in config");
  }

  const publicKey = (
    await execAsync(`echo "${interfaceData.PrivateKey}" | wg pubkey`)
  ).stdout.trim();

  const server = new this({
    name: interfaceName,
    interfaceName: interfaceName,
    address: interfaceData.Address || "10.0.0.1/24",
    listenPort: parseInt(interfaceData.ListenPort) || 51820,
    privateKey: interfaceData.PrivateKey,
    publicKey: publicKey,
    mtu: parseInt(interfaceData.MTU) || 1420,
    dns: interfaceData.DNS ? interfaceData.DNS.split(", ") : [],
    configPath: configPath,
    status: "inactive",
  });

  await server.save();
  return server;
};

const Server = mongoose.model("Server", ServerSchema);
module.exports = Server;
