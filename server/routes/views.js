const express = require("express");
const router = express.Router();

// Dashboard
router.get("/", (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    page: "dashboard",
  });
});

// Server Management
router.get("/servers", (req, res) => {
  res.render("servers", {
    title: "Servers",
    page: "servers",
  });
});

router.get("/servers/:id", (req, res) => {
  res.render("server-detail", {
    title: "Server Details",
    page: "server-detail",
    serverId: req.params.id,
  });
});

// Peer Management
router.get("/peers", (req, res) => {
  res.render("peers", {
    title: "Peers",
    page: "peers",
  });
});

router.get("/peers/:id", (req, res) => {
  res.render("peer-detail", {
    title: "Peer Details",
    page: "peer-detail",
    peerId: req.params.id,
  });
});

// MTU Testing
router.get("/mtu-test", (req, res) => {
  res.render("mtu-test", {
    title: "MTU Testing",
    page: "mtu-test",
  });
});

router.get("/mtu-profiles", (req, res) => {
  res.render("mtu-profiles", {
    title: "MTU Profiles",
    page: "mtu-profiles",
  });
});

// ISP Profiles
router.get("/isp-profiles", (req, res) => {
  res.render("isp-profiles", {
    title: "ISP Profiles",
    page: "isp-profiles",
  });
});

// Interface Management
router.get("/interfaces", (req, res) => {
  res.render("interfaces", {
    title: "Interfaces",
    page: "interfaces",
  });
});

// Statistics
router.get("/stats", (req, res) => {
  res.render("stats", {
    title: "Statistics",
    page: "stats",
  });
});

// Settings
router.get("/settings", (req, res) => {
  res.render("settings", {
    title: "Settings",
    page: "settings",
  });
});

// Backup & Restore
router.get("/backup", (req, res) => {
  res.render("backup", {
    title: "Backup & Restore",
    page: "backup",
  });
});

// Health Check
router.get("/health", (req, res) => {
  res.render("health", {
    title: "Health Check",
    page: "health",
  });
});

module.exports = router;
