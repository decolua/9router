/**
 * Health Check System for 9Router/OmniRoute
 * 
 * Implements comprehensive health monitoring with:
 * - Provider status tracking
 * - System metrics collection
 * - Alerting system
 * - Dashboard integration
 * 
 * Usage:
 *   const healthCheck = require('./health-check');
 *   healthCheck.start();
 *   app.get('/health', healthCheck.endpoint);
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

class HealthCheckSystem {
  constructor(config = {}) {
    this.config = {
      interval: config.interval || 30000, // 30 seconds
      providers: config.providers || [],
      alertThreshold: config.alertThreshold || 0.1, // 10% error rate
      metricsRetention: config.metricsRetention || 24 * 60 * 60 * 1000, // 24 hours
      ...config
    };
    
    this.metrics = {
      providers: {},
      system: {},
      requests: { total: 0, errors: 0, latency: [] }
    };
    
    this.alerts = [];
    this.history = [];
  }

  // Start monitoring
  start() {
    console.log('🏥 Health Check System started');
    this.collectMetrics();
    setInterval(() => this.collectMetrics(), this.config.interval);
  }

  // Collect system metrics
  collectMetrics() {
    const now = Date.now();
    
    // System metrics
    this.metrics.system = {
      cpu: os.loadavg()[0] / os.cpus().length * 100,
      memory: (1 - os.freemem() / os.totalmem()) * 100,
      disk: this.getDiskUsage(),
      uptime: os.uptime(),
      timestamp: new Date(now).toISOString()
    };

    // Clean old history
    this.history = this.history.filter(h => now - h.timestamp < this.config.metricsRetention);
    
    // Save snapshot
    this.history.push({
      timestamp: now,
      system: { ...this.metrics.system },
      providers: { ...this.metrics.providers }
    });
  }

  // Get disk usage
  getDiskUsage() {
    try {
      const stats = fs.statfsSync('/');
      return ((stats.blocks - stats.bfree) / stats.blocks) * 100;
    } catch {
      return 0;
    }
  }

  // Check provider health
  async checkProvider(name, config) {
    const start = Date.now();
    try {
      // Simulate provider check (replace with actual implementation)
      const response = await this.simulateProviderCheck(config);
      const latency = Date.now() - start;
      
      this.metrics.providers[name] = {
        status: 'healthy',
        latency,
        errorRate: 0,
        lastCheck: new Date().toISOString(),
        response
      };
      
      return { status: 'healthy', latency };
    } catch (error) {
      this.metrics.providers[name] = {
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
      
      this.checkAlerts(name, error);
      return { status: 'unhealthy', error: error.message };
    }
  }

  // Simulate provider check (replace with real implementation)
  async simulateProviderCheck(config) {
    // In real implementation, this would make an actual API call
    return { ok: true, latency: Math.random() * 200 };
  }

  // Check and trigger alerts
  checkAlerts(provider, error) {
    const alert = {
      timestamp: new Date().toISOString(),
      provider,
      error: error.message,
      severity: 'error'
    };
    
    this.alerts.push(alert);
    
    // Send alert (implement your preferred method)
    this.sendAlert(alert);
  }

  // Send alert notification
  async sendAlert(alert) {
    // Option 1: Console log
    console.error(`🚨 ALERT: ${alert.provider} - ${alert.error}`);
    
    // Option 2: Telegram (if configured)
    if (this.config.telegram) {
      await this.sendTelegramAlert(alert);
    }
    
    // Option 3: Email (if configured)
    if (this.config.email) {
      await this.sendEmailAlert(alert);
    }
    
    // Option 4: Webhook (if configured)
    if (this.config.webhook) {
      await this.sendWebhookAlert(alert);
    }
  }

  // Send Telegram alert
  async sendTelegramAlert(alert) {
    const message = `🚨 *Health Alert*\n\nProvider: ${alert.provider}\nError: ${alert.error}\nTime: ${alert.timestamp}`;
    
    // Implement Telegram API call
    console.log('Telegram alert:', message);
  }

  // Health endpoint
  endpoint(req, res) {
    const status = this.getOverallStatus();
    
    res.json({
      status: status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      uptime: os.uptime(),
      system: this.metrics.system,
      providers: this.metrics.providers,
      alerts: this.alerts.slice(-10), // Last 10 alerts
      history: this.history.slice(-60) // Last 60 snapshots
    });
  }

  // Get overall status
  getOverallStatus() {
    const providers = Object.values(this.metrics.providers);
    
    if (providers.length === 0) return 'unknown';
    
    const unhealthy = providers.filter(p => p.status === 'unhealthy').length;
    const errorRate = unhealthy / providers.length;
    
    if (errorRate > 0.5) return 'unhealthy';
    if (errorRate > this.config.alertThreshold) return 'degraded';
    return 'healthy';
  }

  // Get provider status
  getProviderStatus(name) {
    return this.metrics.providers[name] || { status: 'unknown' };
  }

  // Record request metrics
  recordRequest(provider, latency, error = null) {
    this.metrics.requests.total++;
    if (error) this.metrics.requests.errors++;
    
    this.metrics.requests.latency.push({
      provider,
      latency,
      timestamp: Date.now()
    });
    
    // Keep only recent latency data
    if (this.metrics.requests.latency.length > 1000) {
      this.metrics.requests.latency = this.metrics.requests.latency.slice(-1000);
    }
  }

  // Get metrics summary
  getMetricsSummary() {
    const latencies = this.metrics.requests.latency;
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((a, b) => a + b.latency, 0) / latencies.length 
      : 0;
    
    return {
      totalRequests: this.metrics.requests.total,
      errorRate: this.metrics.requests.total > 0 
        ? this.metrics.requests.errors / this.metrics.requests.total 
        : 0,
      avgLatency,
      providers: Object.keys(this.metrics.providers).length,
      healthyProviders: Object.values(this.metrics.providers).filter(p => p.status === 'healthy').length
    };
  }
}

// Export singleton instance
module.exports = new HealthCheckSystem();
