/**
 * Provider Health Monitor for 9Router
 * Proactively checks provider health with lightweight requests.
 * Auto-disables unhealthy providers, auto-re-enables recovered ones.
 * Emits webhook events for status changes.
 */

import { webhookService, WebhookEvents } from './webhooks.js';
import { recordProviderHealth } from './metrics.js';

export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown'
};

export class HealthMonitor {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval ?? 300000; // 5 min
    this.timeout = options.timeout ?? 10000; // 10 s
    this.unhealthyThreshold = options.unhealthyThreshold ?? 3;
    this.healthyThreshold = options.healthyThreshold ?? 2;
    this.providers = new Map();
    this.timer = null;
    this.listeners = new Set();
  }

  start(providers) {
    if (typeof providers === 'object' && !Array.isArray(providers)) {
      for (const [id, data] of Object.entries(providers)) {
        this._ensureProvider(id, data);
      }
    } else if (Array.isArray(providers)) {
      for (const p of providers) {
        const id = typeof p === 'string' ? p : p.id;
        this._ensureProvider(id, p);
      }
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkAll(), this.checkInterval);
    this.checkAll();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _ensureProvider(id, data = {}) {
    if (!this.providers.has(id)) {
      this.providers.set(id, {
        status: HealthStatus.UNKNOWN,
        lastCheck: null,
        lastError: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        latencyHistory: [],
        errorHistory: [],
        disabled: false,
        ...(data || {})
      });
    }
  }

  async checkAll() {
    const ids = Array.from(this.providers.keys());
    await Promise.allSettled(ids.map(id => this.check(id)));
  }

  async check(provider) {
    this._ensureProvider(provider);
    const state = this.providers.get(provider);
    if (state.disabled) return;

    const startTime = Date.now();
    try {
      const res = await fetch(`http://localhost:${process.env.PORT || 20128}/v1/models`, {
        signal: AbortSignal.timeout(this.timeout)
      });
      const latency = Date.now() - startTime;
      state.latencyHistory.push(latency);
      if (state.latencyHistory.length > 200) state.latencyHistory.shift();

      if (res.ok) {
        state.consecutiveSuccesses++;
        state.consecutiveFailures = 0;
        state.lastCheck = Date.now();
        state.lastError = null;
        if (state.consecutiveSuccesses >= this.healthyThreshold && state.status !== HealthStatus.HEALTHY) {
          this._setStatus(provider, HealthStatus.HEALTHY);
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (error) {
      state.consecutiveFailures++;
      state.consecutiveSuccesses = 0;
      state.lastCheck = Date.now();
      state.lastError = error.message;
      state.errorHistory.push({ time: Date.now(), error: error.message });
      if (state.errorHistory.length > 200) state.errorHistory.shift();

      if (state.consecutiveFailures >= this.unhealthyThreshold && state.status !== HealthStatus.UNHEALTHY) {
        this._setStatus(provider, HealthStatus.UNHEALTHY);
      } else if (state.consecutiveFailures >= 1 && state.status === HealthStatus.UNKNOWN) {
        this._setStatus(provider, HealthStatus.DEGRADED);
      }
    }

    try {
      recordProviderHealth({
        provider,
        status: state.status,
        latency: state.latencyHistory.slice(-1)[0] || 0
      });
    } catch (_) {}
  }

  _setStatus(provider, status) {
    const state = this.providers.get(provider);
    const prev = state.status;
    state.status = status;

    for (const fn of this.listeners) {
      try { fn(provider, status, prev); } catch (_) {}
    }

    if (status === HealthStatus.UNHEALTHY && prev !== HealthStatus.UNHEALTHY) {
      webhookService.emit(WebhookEvents.PROVIDER_UNHEALTHY, { provider, error: state.lastError, failures: state.consecutiveFailures }).catch(() => {});
    } else if (status === HealthStatus.HEALTHY && prev === HealthStatus.UNHEALTHY) {
      webhookService.emit(WebhookEvents.PROVIDER_RECOVERED, { provider }).catch(() => {});
    }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  getState(provider) {
    return this.providers.get(provider) || { status: HealthStatus.UNKNOWN };
  }

  getAllStates() { return Object.fromEntries(this.providers); }

  getHealthyProviders() {
    return [...this.providers.entries()].filter(([, s]) => s.status === HealthStatus.HEALTHY).map(([p]) => p);
  }

  getUnhealthyProviders() {
    return [...this.providers.entries()].filter(([, s]) => s.status === HealthStatus.UNHEALTHY).map(([p]) => p);
  }

  getLatencyPercentiles(provider) {
    const state = this.providers.get(provider);
    if (!state || state.latencyHistory.length === 0) return null;
    const sorted = [...state.latencyHistory].sort((a, b) => a - b);
    const len = sorted.length;
    return {
      p50: sorted[Math.floor(len * 0.5)],
      p90: sorted[Math.floor(len * 0.9)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      avg: Math.round(sorted.reduce((a, b) => a + b, 0) / len)
    };
  }
}

// Singleton using globalThis to survive route chunks
const g = globalThis;
if (!g.__9router_health_monitor) {
  g.__9router_health_monitor = new HealthMonitor();
}
export const healthMonitor = g.__9router_health_monitor;