// Global Alpine.js store for notifications
document.addEventListener("alpine:init", () => {
  // Notifications store
  Alpine.store("notifications", {
    items: [],

    add(message, type = "info", duration = 5000) {
      const id = Date.now();
      this.items.push({ id, message, type });

      setTimeout(() => this.remove(id), duration);
    },

    remove(id) {
      this.items = this.items.filter((item) => item.id !== id);
    },

    clear() {
      this.items = [];
    },
  });

  // Theme store
  Alpine.store("theme", {
    darkMode: localStorage.getItem("darkMode") === "true",

    toggle() {
      this.darkMode = !this.darkMode;
      localStorage.setItem("darkMode", this.darkMode);
      this.applyTheme();
    },

    applyTheme() {
      if (this.darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    },

    init() {
      this.applyTheme();
    },
  });

  // User store
  Alpine.store("user", {
    isAuthenticated: false,
    userData: null,

    login(userData) {
      this.isAuthenticated = true;
      this.userData = userData;
      localStorage.setItem("user", JSON.stringify(userData));
    },

    logout() {
      this.isAuthenticated = false;
      this.userData = null;
      localStorage.removeItem("user");
    },

    init() {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        this.userData = JSON.parse(savedUser);
        this.isAuthenticated = true;
      }
    },
  });
});

// Global utility functions
const Utils = {
  // Format bytes to human readable
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  },

  // Format duration in seconds to human readable
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return "0s";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(" ");
  },

  // Format date
  formatDate(date, format = "relative") {
    if (!date) return "Never";

    const d = new Date(date);

    if (format === "relative") {
      const now = new Date();
      const diff = now - d;
      const seconds = Math.floor(diff / 1000);

      if (seconds < 60) return "Just now";
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

      return d.toLocaleDateString();
    }

    return d.toLocaleString();
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showNotification("Copied to clipboard!", "success");
      return true;
    } catch (error) {
      console.error("Failed to copy:", error);
      this.showNotification("Failed to copy to clipboard", "error");
      return false;
    }
  },

  // Show notification
  showNotification(message, type = "info") {
    Alpine.store("notifications").add(message, type);
  },

  // Generate random ID
  generateId(length = 8) {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  },

  // Debounce function
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Validate IP address
  isValidIP(ip) {
    const regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    if (!regex.test(ip)) return false;

    const parts = ip.split(/[./]/);
    for (let i = 0; i < 4; i++) {
      const num = parseInt(parts[i]);
      if (num < 0 || num > 255) return false;
    }

    if (parts[4]) {
      const cidr = parseInt(parts[4]);
      if (cidr < 0 || cidr > 32) return false;
    }

    return true;
  },

  // Validate port
  isValidPort(port) {
    const num = parseInt(port);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },

  // Get ISP from Myanmar phone number
  getISPFromPhoneNumber(phone) {
    if (!phone) return "UNKNOWN";

    const prefixes = {
      "09": "MPT",
      "099": "OOREDOO",
      "096": "MYTEL",
      "097": "ATOM",
      "094": "TELENOR",
    };

    for (const [prefix, isp] of Object.entries(prefixes)) {
      if (phone.startsWith(prefix)) {
        return isp;
      }
    }

    return "UNKNOWN";
  },

  // Get color for ISP
  getISPColor(isp) {
    const colors = {
      MPT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      OOREDOO: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      MYTEL:
        "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      ATOM: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      TELENOR: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300",
      UNKNOWN: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    };

    return colors[isp] || colors.UNKNOWN;
  },

  // Get status color
  getStatusColor(status) {
    const colors = {
      active:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      connected:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
      disconnected:
        "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
      pending:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      disabled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };

    return colors[status] || colors.inactive;
  },
};

// API Client
const API = {
  baseURL: "/api",

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaultOptions = {
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    };

    try {
      const response = await fetch(url, { ...defaultOptions, ...options });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.error || "Request failed");
      }

      return await response.json();
    } catch (error) {
      console.error("API request failed:", error);
      Utils.showNotification(error.message, "error");
      throw error;
    }
  },

  // Servers
  async getServers() {
    return this.request("/servers");
  },

  async getServer(id) {
    return this.request(`/servers/${id}`);
  },

  async createServer(data) {
    return this.request("/servers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateServer(id, data) {
    return this.request(`/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteServer(id) {
    return this.request(`/servers/${id}`, {
      method: "DELETE",
    });
  },

  async startServer(interfaceName) {
    return this.request(`/servers/${interfaceName}/start`, {
      method: "POST",
    });
  },

  async stopServer(interfaceName) {
    return this.request(`/servers/${interfaceName}/stop`, {
      method: "POST",
    });
  },

  async restartServer(interfaceName) {
    return this.request(`/servers/${interfaceName}/restart`, {
      method: "POST",
    });
  },

  // Peers
  async getPeers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/peers${query ? "?" + query : ""}`);
  },

  async getPeer(id) {
    return this.request(`/peers/${id}`);
  },

  async createPeer(data) {
    return this.request("/peers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updatePeer(id, data) {
    return this.request(`/peers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deletePeer(id) {
    return this.request(`/peers/${id}`, {
      method: "DELETE",
    });
  },

  async enablePeer(id) {
    return this.request(`/peers/${id}/enable`, {
      method: "POST",
    });
  },

  async disablePeer(id) {
    return this.request(`/peers/${id}/disable`, {
      method: "POST",
    });
  },

  async getPeerConfig(id) {
    return this.request(`/peers/${id}/config`);
  },

  // MTU Testing
  async testMTU(data) {
    return this.request("/mtu/test", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getMTUProfiles(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/mtu/profiles${query ? "?" + query : ""}`);
  },

  async applyMTUProfile(profileId, interfaceName) {
    return this.request(`/mtu/profiles/${profileId}/apply`, {
      method: "POST",
      body: JSON.stringify({ interfaceName }),
    });
  },

  // ISP Profiles
  async getISPProfiles() {
    return this.request("/mtu/isp-profiles");
  },

  async applyISPProfile(interfaceName, ispProfile) {
    return this.request(`/servers/${interfaceName}/apply-isp`, {
      method: "POST",
      body: JSON.stringify({ ispProfile }),
    });
  },

  // Statistics
  async getStats() {
    return this.request("/stats");
  },

  async getHealth() {
    return this.request("/health");
  },

  // Interfaces
  async getInterfaces() {
    return this.request("/interfaces");
  },

  // Backup
  async backupInterface(interfaceName) {
    return this.request(`/backup/${interfaceName}`, {
      method: "POST",
    });
  },

  // Generate keys
  async generateKeys() {
    return this.request("/generate-keys", {
      method: "POST",
    });
  },

  // Search
  async search(query, type) {
    return this.request(`/search?q=${encodeURIComponent(query)}&type=${type}`);
  },
};

// Initialize theme on load
document.addEventListener("DOMContentLoaded", () => {
  Alpine.store("theme").init();
  Alpine.store("user").init();
});

// Export to global scope
window.Utils = Utils;
window.API = API;
