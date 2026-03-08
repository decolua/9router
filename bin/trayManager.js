const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');

class TrayManager {
  constructor(port = 20128) {
    this.port = port;
    this.tray = null;
    this.refreshInterval = null;
    this.cachedData = {
      modelInUse: null,
      context: null,
      quotas: [],
      mitmStatus: null,
      lastUpdate: null
    };
  }

  /**
   * Initialize the system tray
   */
  async init() {
    try {
      // Create tray icon (use a simple icon for now)
      const icon = this.createTrayIcon();
      this.tray = new Tray(icon);
      this.tray.setToolTip('9Router');

      // Build initial menu
      await this.updateMenu();

      // Start periodic refresh (every 5 seconds)
      this.refreshInterval = setInterval(() => {
        this.updateMenu();
      }, 5000);

      console.log('System tray initialized');
    } catch (error) {
      console.error('Failed to initialize system tray:', error);
    }
  }

  /**
   * Create a simple tray icon
   */
  createTrayIcon() {
    try {
      // Try to create a simple 16x16 icon with text "9R"
      const canvas = require('canvas');
      const canvasEl = canvas.createCanvas(16, 16);
      const ctx = canvasEl.getContext('2d');

      // Background
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(0, 0, 16, 16);

      // Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('9R', 8, 8);

      return nativeImage.createFromDataURL(canvasEl.toDataURL());
    } catch (error) {
      console.warn('Failed to create canvas icon, using fallback:', error.message);

      // Fallback: Create a simple colored square
      // This is a 16x16 blue square as a base64 PNG
      const base64Icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAYdEVYdFRpdGxlADlSb3V0ZXIgVHJheSBJY29uP5cK3wAAABl0RVh0QXV0aG9yADlSb3V0ZXIgRGV2ZWxvcGVy5kN5HwAAADhJREFUOI1jYBgFoyFABjDiU8DMzMyITy0DAwMDEz6FjIyMjPgUMjAwMDDiU8jIyMiITyEDAwPDKAAA8KgCEX7E3bQAAAAASUVORK5CYII=';
      return nativeImage.createFromDataURL(base64Icon);
    }
  }

  /**
   * Fetch data from local API
   */
  async fetchData(endpoint) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: this.port,
        path: endpoint,
        method: 'GET',
        timeout: 2000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Get usage statistics
   */
  async getUsageStats() {
    try {
      const stats = await this.fetchData('/api/usage/stats?period=24h');
      return stats;
    } catch (error) {
      console.error('Failed to fetch usage stats:', error.message);
      return null;
    }
  }

  /**
   * Get MITM status
   */
  async getMitmStatus() {
    try {
      const status = await this.fetchData('/api/cli-tools/antigravity-mitm');
      return status;
    } catch (error) {
      console.error('Failed to fetch MITM status:', error.message);
      return null;
    }
  }

  /**
   * Get the most recently used model
   */
  getRecentModel(stats) {
    if (!stats || !stats.byModel) return null;

    let mostRecent = null;
    let latestTime = 0;

    for (const [modelKey, modelData] of Object.entries(stats.byModel)) {
      const lastUsed = new Date(modelData.lastUsed).getTime();
      if (lastUsed > latestTime) {
        latestTime = lastUsed;
        mostRecent = {
          provider: modelData.provider,
          model: modelData.rawModel || modelKey,
          fullModel: `${modelData.provider}/${modelData.rawModel || modelKey}`
        };
      }
    }

    return mostRecent;
  }

  /**
   * Format token count
   */
  formatTokens(count) {
    if (!count && count !== 0) return '0';
    if (count < 1000) return count.toString();
    if (count < 1000000) return (count / 1000).toFixed(1) + 'K';
    return (count / 1000000).toFixed(1) + 'M';
  }

  /**
   * Format time ago
   */
  formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';

    const now = Date.now();
    const diff = now - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  /**
   * Update the tray menu with fresh data
   */
  async updateMenu() {
    try {
      // Fetch all required data
      const [stats, mitmStatus] = await Promise.all([
        this.getUsageStats(),
        this.getMitmStatus()
      ]);

      // Update cached data
      if (stats) {
        this.cachedData.modelInUse = this.getRecentModel(stats);
        this.cachedData.context = {
          input: stats.totalPromptTokens || 0,
          output: stats.totalCompletionTokens || 0,
          total: (stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0),
          lastUpdate: stats.recentRequests?.[0]?.timestamp
        };

        // Build quota list
        this.cachedData.quotas = [];
        if (stats.byProvider) {
          for (const [provider, data] of Object.entries(stats.byProvider)) {
            this.cachedData.quotas.push({
              provider,
              requests: data.requests,
              tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
              cost: data.cost || 0
            });
          }
        }
      }

      if (mitmStatus) {
        this.cachedData.mitmStatus = mitmStatus;
      }

      this.cachedData.lastUpdate = Date.now();

      // Build menu
      const menu = this.buildMenu();
      this.tray.setContextMenu(menu);
    } catch (error) {
      console.error('Failed to update tray menu:', error);
      // Build fallback menu
      const fallbackMenu = this.buildFallbackMenu();
      this.tray.setContextMenu(fallbackMenu);
    }
  }

  /**
   * Build the tray menu
   */
  buildMenu() {
    const menuTemplate = [];

    // Title
    menuTemplate.push({
      label: `9Router (Port ${this.port})`,
      enabled: false
    });

    menuTemplate.push({ type: 'separator' });

    // Open Dashboard
    menuTemplate.push({
      label: 'Open Dashboard',
      click: () => {
        try {
          require('open')(`http://localhost:${this.port}/dashboard`);
        } catch (error) {
          console.error('Failed to open dashboard:', error);
          // Fallback: Try to show the window if available
          const { BrowserWindow } = require('electron');
          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            windows[0].show();
          }
        }
      }
    });

    menuTemplate.push({ type: 'separator' });

    // Model in use
    if (this.cachedData.modelInUse) {
      menuTemplate.push({
        label: `Model: ${this.cachedData.modelInUse.fullModel}`,
        enabled: false
      });
    } else {
      menuTemplate.push({
        label: 'Model: None',
        enabled: false
      });
    }

    menuTemplate.push({ type: 'separator' });

    // Context information
    if (this.cachedData.context) {
      const ctx = this.cachedData.context;
      menuTemplate.push({
        label: 'Context (24h):',
        enabled: false
      });
      menuTemplate.push({
        label: `  Input: ${this.formatTokens(ctx.input)}`,
        enabled: false
      });
      menuTemplate.push({
        label: `  Output: ${this.formatTokens(ctx.output)}`,
        enabled: false
      });
      menuTemplate.push({
        label: `  Total: ${this.formatTokens(ctx.total)}`,
        enabled: false
      });
      if (ctx.lastUpdate) {
        menuTemplate.push({
          label: `  Last: ${this.formatTimeAgo(ctx.lastUpdate)}`,
          enabled: false
        });
      }
    }

    menuTemplate.push({ type: 'separator' });

    // Quota Tracker
    if (this.cachedData.quotas && this.cachedData.quotas.length > 0) {
      menuTemplate.push({
        label: 'Quota Tracker (24h):',
        enabled: false
      });

      // Show top 5 providers by usage
      const sortedQuotas = this.cachedData.quotas
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5);

      sortedQuotas.forEach(quota => {
        menuTemplate.push({
          label: `  ${quota.provider}: ${this.formatTokens(quota.tokens)} (${quota.requests} req)`,
          enabled: false
        });
      });

      if (this.cachedData.quotas.length > 5) {
        menuTemplate.push({
          label: `  ...and ${this.cachedData.quotas.length - 5} more`,
          enabled: false
        });
      }
    }

    menuTemplate.push({ type: 'separator' });

    // MITM Server
    if (this.cachedData.mitmStatus) {
      const isRunning = this.cachedData.mitmStatus.running;
      menuTemplate.push({
        label: `MITM Server: ${isRunning ? 'Enabled ✓' : 'Disabled'}`,
        click: () => {
          this.toggleMitm();
        }
      });
    }

    menuTemplate.push({ type: 'separator' });

    // Autostart (placeholder for now)
    menuTemplate.push({
      label: 'Autostart',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        this.toggleAutostart(menuItem.checked);
      }
    });

    menuTemplate.push({ type: 'separator' });

    // Quit
    menuTemplate.push({
      label: 'Quit',
      click: () => {
        this.cleanup();
        app.quit();
      }
    });

    return Menu.buildFromTemplate(menuTemplate);
  }

  /**
   * Build fallback menu when API is not available
   */
  buildFallbackMenu() {
    const menuTemplate = [
      {
        label: `9Router (Port ${this.port})`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => {
          try {
            require('open')(`http://localhost:${this.port}/dashboard`);
          } catch (error) {
            console.error('Failed to open dashboard:', error);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Server not responding...',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Autostart',
        type: 'checkbox',
        checked: false
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.cleanup();
          app.quit();
        }
      }
    ];

    return Menu.buildFromTemplate(menuTemplate);
  }

  /**
   * Toggle MITM server
   */
  async toggleMitm() {
    try {
      const currentStatus = this.cachedData.mitmStatus;
      if (!currentStatus) return;

      const method = currentStatus.running ? 'DELETE' : 'POST';

      // For POST, we need an API key
      let body = '';
      if (method === 'POST') {
        // Try to get API key from settings
        const settings = await this.fetchData('/api/settings');
        const apiKey = settings?.apiKey || 'default-key';
        body = JSON.stringify({ apiKey });
      }

      // Make request
      const options = {
        hostname: 'localhost',
        port: this.port,
        path: '/api/cli-tools/antigravity-mitm',
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            // Refresh menu after toggle
            setTimeout(() => this.updateMenu(), 1000);
            resolve();
          });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    } catch (error) {
      console.error('Failed to toggle MITM:', error);
    }
  }

  /**
   * Toggle autostart
   */
  toggleAutostart(enabled) {
    // TODO: Implement autostart functionality
    // This would require platform-specific implementations:
    // - Windows: Registry entry
    // - macOS: Login Items
    // - Linux: .desktop file in autostart
    console.log('Autostart:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
