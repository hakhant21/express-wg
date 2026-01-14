const mongoose = require("mongoose");

const MTUProfileSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Profile name is required"],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isp: {
      type: String,
      enum: ["MPT", "OOREDOO", "MYTEL", "ATOM", "TELENOR", "CUSTOM", "UNKNOWN"],
      default: "UNKNOWN",
      index: true,
    },
    mtu: {
      type: Number,
      required: [true, "MTU value is required"],
      min: [576, "MTU cannot be less than 576"],
      max: [9000, "MTU cannot exceed 9000"],
      index: true,
    },
    recommendedRange: {
      min: {
        type: Number,
        required: true,
        min: [576, "Minimum MTU cannot be less than 576"],
      },
      max: {
        type: Number,
        required: true,
        max: [9000, "Maximum MTU cannot exceed 9000"],
      },
      step: {
        type: Number,
        default: 20,
        min: [1, "Step must be at least 1"],
      },
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
    testResults: {
      pingSuccessRate: { type: Number, min: 0, max: 100 },
      averageLatency: { type: Number, min: 0 },
      packetLoss: { type: Number, min: 0, max: 100 },
      throughput: { type: Number, min: 0 },
      jitter: { type: Number, min: 0 },
      lastTested: Date,
      testDuration: { type: Number, default: 0 },
    },
    appliedTo: [
      {
        server: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Server",
        },
        interfaceName: String,
        appliedAt: {
          type: Date,
          default: Date.now,
        },
        success: Boolean,
        error: String,
        previousMTU: Number,
        latencyImprovement: Number,
        throughputImprovement: Number,
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
        index: true,
      },
    ],
    notes: {
      type: String,
      maxlength: [2000, "Notes cannot exceed 2000 characters"],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
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
MTUProfileSchema.virtual("isOptimal").get(function () {
  if (!this.testResults) return false;
  return (
    this.testResults.pingSuccessRate >= 95 &&
    this.testResults.packetLoss <= 5 &&
    this.testResults.averageLatency <= 100
  );
});

MTUProfileSchema.virtual("testCount").get(function () {
  return this.appliedTo ? this.appliedTo.length : 0;
});

MTUProfileSchema.virtual("successRate").get(function () {
  if (!this.appliedTo || this.appliedTo.length === 0) return 0;
  const successes = this.appliedTo.filter((a) => a.success).length;
  return (successes / this.appliedTo.length) * 100;
});

// Indexes
MTUProfileSchema.index({ isp: 1, mtu: 1 });
MTUProfileSchema.index({ "testResults.lastTested": -1 });
MTUProfileSchema.index({ isDefault: 1 });
MTUProfileSchema.index({ tags: 1 });

// Middleware
MTUProfileSchema.pre("save", function (next) {
  this.updatedAt = Date.now();

  // Only one default profile per ISP
  if (this.isDefault && this.isModified("isDefault")) {
    next();
  } else {
    next();
  }
});

MTUProfileSchema.pre("save", async function (next) {
  if (this.isDefault && this.isModified("isDefault")) {
    const MTUProfile = mongoose.model("MTUProfile");
    await MTUProfile.updateMany(
      { isp: this.isp, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

// Instance Methods
MTUProfileSchema.methods.applyToServer = async function (serverId) {
  const Server = mongoose.model("Server");
  const server = await Server.findById(serverId);

  if (!server) {
    throw new Error("Server not found");
  }

  // Store previous MTU
  const previousMTU = server.mtu;

  // Update server MTU
  server.mtu = this.mtu;
  server.ispProfile = this.isp;

  if (this.dns && this.dns.length > 0) {
    server.dns = this.dns;
  }

  if (this.persistentKeepalive) {
    server.persistentKeepalive = this.persistentKeepalive;
  }

  await server.save();

  // Record application
  this.appliedTo.push({
    server: server._id,
    interfaceName: server.interfaceName,
    appliedAt: new Date(),
    success: true,
    previousMTU: previousMTU,
  });

  await this.save();

  return {
    success: true,
    message: `Applied MTU profile "${this.name}" to ${server.interfaceName}`,
    previousMTU,
    newMTU: this.mtu,
    server: server.toPublicJSON(),
  };
};

MTUProfileSchema.methods.runTest = async function (testHost = "8.8.8.8") {
  const ping = require("ping");
  const { exec } = require("child_process");
  const util = require("util");
  const execAsync = util.promisify(exec);

  const results = {
    pingResults: [],
    latency: [],
    packetLoss: 0,
  };

  // Test with different packet sizes
  const packetSizes = [64, 512, 1024, this.mtu - 28];

  for (const size of packetSizes) {
    try {
      const res = await ping.promise.probe(testHost, {
        timeout: 2,
        extra: ["-s", size.toString()],
      });

      results.pingResults.push({
        packetSize: size,
        alive: res.alive,
        time: res.time,
        success: res.alive && res.time < 100,
      });

      if (res.alive) {
        results.latency.push(res.time);
      } else {
        results.packetLoss++;
      }
    } catch (error) {
      results.pingResults.push({
        packetSize: size,
        alive: false,
        time: null,
        error: error.message,
      });
      results.packetLoss++;
    }
  }

  // Calculate statistics
  const successfulPings = results.pingResults.filter((r) => r.success).length;
  const totalPings = results.pingResults.length;

  this.testResults = {
    pingSuccessRate: totalPings > 0 ? (successfulPings / totalPings) * 100 : 0,
    averageLatency:
      results.latency.length > 0
        ? results.latency.reduce((a, b) => a + b, 0) / results.latency.length
        : 0,
    packetLoss: totalPings > 0 ? (results.packetLoss / totalPings) * 100 : 0,
    lastTested: new Date(),
  };

  await this.save();

  return {
    profile: this.name,
    mtu: this.mtu,
    testResults: this.testResults,
    details: results,
  };
};

MTUProfileSchema.methods.compareWith = async function (otherProfileId) {
  const MTUProfile = mongoose.model("MTUProfile");
  const otherProfile = await MTUProfile.findById(otherProfileId);

  if (!otherProfile) {
    throw new Error("Comparison profile not found");
  }

  const comparison = {
    profile1: {
      name: this.name,
      mtu: this.mtu,
      isp: this.isp,
      testResults: this.testResults,
    },
    profile2: {
      name: otherProfile.name,
      mtu: otherProfile.mtu,
      isp: otherProfile.isp,
      testResults: otherProfile.testResults,
    },
    differences: {},
  };

  // Calculate differences
  if (this.testResults && otherProfile.testResults) {
    comparison.differences.latency =
      this.testResults.averageLatency - otherProfile.testResults.averageLatency;
    comparison.differences.packetLoss =
      this.testResults.packetLoss - otherProfile.testResults.packetLoss;
    comparison.differences.successRate =
      this.testResults.pingSuccessRate -
      otherProfile.testResults.pingSuccessRate;

    // Determine which is better
    let profile1Score = 0;
    let profile2Score = 0;

    // Lower latency is better
    if (
      this.testResults.averageLatency < otherProfile.testResults.averageLatency
    )
      profile1Score++;
    else profile2Score++;

    // Lower packet loss is better
    if (this.testResults.packetLoss < otherProfile.testResults.packetLoss)
      profile1Score++;
    else profile2Score++;

    // Higher success rate is better
    if (
      this.testResults.pingSuccessRate >
      otherProfile.testResults.pingSuccessRate
    )
      profile1Score++;
    else profile2Score++;

    comparison.betterProfile =
      profile1Score > profile2Score
        ? this.name
        : profile2Score > profile1Score
        ? otherProfile.name
        : "tie";
    comparison.score = { profile1: profile1Score, profile2: profile2Score };
  }

  return comparison;
};

// Static Methods
MTUProfileSchema.statics.getDefaultForISP = async function (isp) {
  return this.findOne({ isp, isDefault: true });
};

MTUProfileSchema.statics.getRecommendedForISP = async function (isp) {
  const profiles = await this.find({ isp })
    .sort({
      "testResults.pingSuccessRate": -1,
      "testResults.averageLatency": 1,
    })
    .limit(1);

  return profiles[0] || null;
};

MTUProfileSchema.statics.bulkCreateForISP = async function (
  isp,
  baseMTU = 1400
) {
  const profiles = [];
  const ranges = [
    { min: 1280, max: 1320, step: 20 },
    { min: 1340, max: 1380, step: 20 },
    { min: 1400, max: 1440, step: 20 },
    { min: 1460, max: 1500, step: 20 },
  ];

  for (const range of ranges) {
    for (let mtu = range.min; mtu <= range.max; mtu += range.step) {
      const profileName = `${isp}_MTU_${mtu}`;

      const profile = new this({
        name: profileName,
        description: `MTU ${mtu} for ${isp} network`,
        isp: isp,
        mtu: mtu,
        recommendedRange: range,
        dns: ["8.8.8.8", "8.8.4.4"],
        persistentKeepalive: 25,
        tags: [isp, `mtu-${mtu}`, "auto-generated"],
      });

      await profile.save();
      profiles.push(profile);
    }
  }

  // Set the middle one as default
  if (profiles.length > 0) {
    const defaultIndex = Math.floor(profiles.length / 2);
    profiles[defaultIndex].isDefault = true;
    await profiles[defaultIndex].save();
  }

  return profiles;
};

MTUProfileSchema.statics.analyzeTestResults = async function () {
  const analysis = await this.aggregate([
    {
      $group: {
        _id: "$isp",
        totalProfiles: { $sum: 1 },
        testedProfiles: {
          $sum: {
            $cond: [{ $ne: ["$testResults", null] }, 1, 0],
          },
        },
        avgMTU: { $avg: "$mtu" },
        avgLatency: { $avg: "$testResults.averageLatency" },
        avgPacketLoss: { $avg: "$testResults.packetLoss" },
        bestMTU: {
          $max: {
            $cond: [
              {
                $and: [
                  { $ne: ["$testResults", null] },
                  { $gte: ["$testResults.pingSuccessRate", 95] },
                ],
              },
              "$mtu",
              null,
            ],
          },
        },
        profiles: {
          $push: {
            name: "$name",
            mtu: "$mtu",
            latency: "$testResults.averageLatency",
            packetLoss: "$testResults.packetLoss",
            successRate: "$testResults.pingSuccessRate",
          },
        },
      },
    },
    {
      $project: {
        isp: "$_id",
        totalProfiles: 1,
        testedProfiles: 1,
        testCoverage: {
          $multiply: [{ $divide: ["$testedProfiles", "$totalProfiles"] }, 100],
        },
        avgMTU: 1,
        avgLatency: 1,
        avgPacketLoss: 1,
        bestMTU: 1,
        profiles: {
          $filter: {
            input: "$profiles",
            as: "profile",
            cond: { $ne: ["$$profile.latency", null] },
          },
        },
      },
    },
    { $sort: { isp: 1 } },
  ]);

  return analysis;
};

const MTUProfile = mongoose.model("MTUProfile", MTUProfileSchema);

// Initialize default profiles
MTUProfile.initDefaults = async function () {
  const isps = ["MPT", "OOREDOO", "MYTEL", "ATOM", "TELENOR"];

  for (const isp of isps) {
    const exists = await this.findOne({ isp, isDefault: true });
    if (!exists) {
      await this.bulkCreateForISP(isp);
    }
  }
};

module.exports = MTUProfile;
