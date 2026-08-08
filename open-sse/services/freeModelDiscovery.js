/**
 * Free Model Discovery Service for 9Router
 * Automatically discovers and tracks free models across providers.
 * Scans known free model endpoints periodically.
 */

import { webhookService } from './webhooks.js';

const FREE_MODEL_SOURCES = {
  'nvidia': {
    url: 'https://integrate.api.nvidia.com/v1/models',
    filter: (m) => m.id && (m.id.includes('free') || m.pricing?.prompt === '0')
  },
  'openrouter': {
    url: 'https://openrouter.ai/api/v1/models',
    filter: (m) => m.id && (m.id.endsWith(':free') || String(m.pricing?.prompt) === '0')
  },
  'groq': {
    url: 'https://api.groq.com/openai/v1/models',
    filter: () => true
  },
  'cerebras': {
    url: 'https://api.cerebras.ai/v1/models',
    filter: () => true
  }
};

export class FreeModelDiscovery {
  constructor() {
    this.discovered = new Map();
    this.lastScan = null;
    this.scanInterval = 3600000;
    this.timer = null;
    this.changeHistory = [];
  }

  start() {
    this.timer = setInterval(() => this.scan(), this.scanInterval);
    this.scan().catch(e => console.error('[FreeModelDiscovery] initial scan failed:', e.message));
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async scan() {
    const changes = { added: [], removed: [] };

    for (const [provider, config] of Object.entries(FREE_MODEL_SOURCES)) {
      try {
        const models = await this._fetchModels(provider, config);
        const prevIds = new Set();
        for (const [key, val] of this.discovered) {
          if (key.startsWith(`${provider}/`)) prevIds.add(val.model);
        }

        for (const model of models) {
          const fullId = `${provider}/${model.id}`;
          if (!prevIds.has(model.id)) {
            changes.added.push({ provider, model: model.id, name: model.name });
            this.discovered.set(fullId, {
              provider, model: model.id, name: model.name || model.id,
              context_length: model.context_length || null,
              discovered_at: Date.now(), status: 'active'
            });
          }
        }

        for (const prevId of prevIds) {
          if (!models.find(m => m.id === prevId)) {
            changes.removed.push({ provider, model: prevId });
            this.discovered.delete(`${provider}/${prevId}`);
          }
        }
      } catch (error) {
        console.error(`[FreeModelDiscovery] scan ${provider} failed:`, error.message);
      }
    }

    this.lastScan = Date.now();

    if (changes.added.length > 0 || changes.removed.length > 0) {
      this.changeHistory.push({ timestamp: Date.now(), changes });
      if (this.changeHistory.length > 100) this.changeHistory.shift();
      webhookService.emit('free_models.changed', changes).catch(() => {});
    }

    return changes;
  }

  async _fetchModels(provider, config) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'nvidia' && process.env.NVIDIA_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.NVIDIA_API_KEY}`;
    }
    if (provider === 'groq' && process.env.GROQ_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.GROQ_API_KEY}`;
    }
    if (provider === 'cerebras' && process.env.CEREBRAS_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.CEREBRAS_API_KEY}`;
    }

    const res = await fetch(config.url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const models = data.data || data.models || [];
    return models.filter(config.filter).map(m => ({
      id: m.id, name: m.name || m.id,
      context_length: m.context_length || m.max_context_length || null
    }));
  }

  getAll() { return Array.from(this.discovered.values()); }
  getByProvider(provider) { return this.getAll().filter(m => m.provider === provider); }

  getStats() {
    const all = this.getAll();
    const providers = [...new Set(all.map(m => m.provider))];
    return {
      total: all.length, providers: providers.length, lastScan: this.lastScan,
      byProvider: providers.map(p => ({ provider: p, count: all.filter(m => m.provider === p).length }))
    };
  }

  getHistory() { return this.changeHistory.slice(-50); }
}

const g = globalThis;
if (!g.__9router_free_model_discovery) g.__9router_free_model_discovery = new FreeModelDiscovery();
export const freeModelDiscovery = g.__9router_free_model_discovery;