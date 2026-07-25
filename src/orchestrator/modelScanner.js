import { getProviderConnections, getProviderNodes, getSettings, updateSettings } from '@/lib/localDb.js';
import { getAdapter } from '@/lib/db/driver.js';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';

const BENCHMARK_CHAT = 'Ответь одним словом: работаю.';

const BENCHMARK_CODE = `Напиши функцию на python которая сортирует список чисел пузырьком (bubble sort). Верни только код, без пояснений.`;

const BENCHMARK_REASONING = `Объясни разницу между AI-агентами и обычными языковыми моделями в 2-3 предложениях.`;

const PROVIDER_ENDPOINTS = {
  routerai: 'https://routerai.ru/api/v1',
  opencode: 'https://opencode.ai/zen/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  '9router': `http://localhost:${process.env.PORT || 20128}/api/v1`,
  ollama: 'http://localhost:11434',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  scaleway: 'https://api.scaleway.ai/v1',
  ai21: 'https://api.ai21.com/studio/v1',
  upstage: 'https://api.upstage.ai/v1/solar',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openai: '',
  huggingface: 'https://router.huggingface.co/v1',
};

export class ModelScanner {
  constructor() {
    this.results = [];
    this._progress = [];
    this._scanInProgress = false;
  }

  getProgress() {
    return [...(this._progress || [])];
  }

  async getHiddenModels() {
    try {
      const settings = await getSettings();
      return settings.hiddenModels || {};
    } catch { return {}; }
  }

  async hideBrokenModels() {
    const hidden = await this.getHiddenModels();
    const now = Date.now();
    for (const r of this.results) {
      if (r.status !== 'ok') {
        const key = `${r.provider}/${r.model}`;
        if (!hidden[key]) {
          hidden[key] = {
            hiddenAt: now,
            nextCheckAt: now + 3600000,
            failures: 1,
            lastError: r.error,
            model: r.model,
            provider: r.provider,
          };
        } else {
          hidden[key].lastError = r.error;
          hidden[key].failures = (hidden[key].failures || 0) + 1;
        }
      }
    }
    try { await updateSettings({ hiddenModels: hidden }); } catch {}
    return hidden;
  }

  async unhideModel(provider, model) {
    const hidden = await this.getHiddenModels();
    const key = `${provider}/${model}`;
    if (hidden[key]) {
      delete hidden[key];
      try { await updateSettings({ hiddenModels: hidden }); } catch {}
    }
    return hidden;
  }

  async unhideAll() {
    try { await updateSettings({ hiddenModels: {} }); } catch {}
    return {};
  }

  async scanQuick() {
    const hidden = await this.getHiddenModels();
    const hiddenKeys = new Set(Object.keys(hidden));
    const all = await this.scanAll();
    all.models = all.models.filter(m => !hiddenKeys.has(`${m.provider}/${m.model}`));
    all.config = this._generateConfig(all.models);
    return all;
  }

  async autodiscoverOnce() {
    const hidden = await this.getHiddenModels();
    const now = Date.now();
    const due = [];
    const nextBackoff = { 1: 3, 2: 6, 3: 24 };

    for (const [key, h] of Object.entries(hidden)) {
      if (now >= (h.nextCheckAt || 0)) {
        due.push({ key, ...h });
      }
    }

    if (due.length === 0) {
      return { checked: [], hidden: Object.keys(hidden).length };
    }

    const connections = await getProviderConnections();
    const results = [];
    for (const d of due) {
      const conn = connections.find(c =>
        this._normalizeProvider(c.provider) === d.provider
      );
      if (!conn) continue;
      try {
        const endpoint = conn.endpoint || PROVIDER_ENDPOINTS[d.provider];
        if (!endpoint) continue;
        const r = await this._callModel(
          endpoint,
          { 'Content-Type': 'application/json', ...(conn.apiKey ? { 'Authorization': `Bearer ${conn.apiKey}` } : {}) },
          d.model, 'Ответь одним словом: работаю.'
        );
        hidden[d.key].failures = 0;
        hidden[d.key].nextCheckAt = now + 86400000;
        delete hidden[d.key].lastError;
        results.push({ model: d.model, provider: d.provider, status: 'ok' });
      } catch (err) {
        const f = (hidden[d.key].failures || 0) + 1;
        hidden[d.key].failures = f;
        hidden[d.key].lastError = err.message;
        const backoffHours = nextBackoff[f] || 24;
        hidden[d.key].nextCheckAt = now + backoffHours * 3600000;
        results.push({ model: d.model, provider: d.provider, status: 'error', error: err.message });
      }
    }

    try { await updateSettings({ hiddenModels: hidden }); } catch {}
    return { checked: results, hidden: Object.keys(hidden).length };
  }

  async scanAll(skipHidden = false) {
    if (this._scanInProgress) {
      console.log('[ModelScanner] scan already in progress, skipping');
      return { models: this.results, config: this._generateConfig(this.results) };
    }
    try {
    this._scanInProgress = true;
    this._progress = [];
    const connections = await getProviderConnections();
    const allTests = [];
    const hidden = skipHidden ? await this.getHiddenModels() : {};
    const hiddenKeys = new Set(Object.keys(hidden));

    for (const conn of connections) {
      if (!conn.isActive) continue;
      let provider = this._normalizeProvider(conn.provider);
      const endpoint = conn.endpoint || PROVIDER_ENDPOINTS[provider];
      if (!endpoint) continue;

      // Определяем реального провайдера по endpoint, а не по ID ноды
      if (provider === 'openai') {
        if (endpoint.includes('routerai')) provider = 'routerai';
        else if (endpoint.includes('opencode')) provider = 'opencode';
        else if (endpoint.includes('openrouter')) provider = 'openrouter';
      }

      // Не тестируем провайдеров без API-ключа (кроме бесплатных)
      const hasApiKey = !!(conn.apiKey || process.env[`PROVIDER_${provider.toUpperCase().replace(/-/g, '_')}_KEY`]);
      const isFreeProvider = ['ollama', 'opencode'].includes(provider);
      if (!hasApiKey && !isFreeProvider && provider !== 'openai') {
        console.log(`[ModelScanner] ⏭ Skipping ${provider} — no API key`);
        continue;
      }

      // OpenCode: разделяем free (Bearer public) и paid (opencode-go + API key) модели
      if (provider === 'opencode') {
        let models = await this._discoverOpenCodeFreeModels();
        if (models.length === 0) models = this._getFallbackModels(provider);
        const hasGoKey = !!(conn.apiKey || process.env.PROVIDER_OPENCODE_KEY || '');
        for (const model of models) {
          const isFree = model.includes('-free');
          // Без paid-ключа тестируем только -free модели
          if (!isFree && !hasGoKey) continue;
          allTests.push({
            connection: conn,
            provider: isFree ? 'opencode' : 'opencode-go',
            endpoint: isFree ? endpoint : 'https://opencode.ai/zen/go/v1',
            model,
            apiKey: isFree ? '' : (conn.apiKey || process.env.PROVIDER_OPENCODE_KEY || ''),
          });
        }
        continue;
      }

      let models = await this._discoverModels(conn, provider);
      if (models.length === 0) models = this._getFallbackModels(provider);

      for (const model of models) {
        if (skipHidden && hiddenKeys.has(`${provider}/${model}`)) continue;
        allTests.push({ connection: conn, provider, endpoint, model, apiKey: conn.apiKey || '' });
      }
    }

    // Also discover models from providerNodes (LM Studio, OpenAI-compatible, Anthropic-compatible)
    const nodes = await getProviderNodes();
    for (const node of nodes) {
      if (node.type === 'openai-compatible' || node.type === 'anthropic-compatible') {
        const baseUrl = (node.baseUrl || '').replace(/\/+$/, '');
        if (!baseUrl) continue;
        // Если нода ведёт на RouterAI — используем только deepseek/deepseek-v4-flash
        if (baseUrl.includes('routerai')) {
          const models = await this._discoverRouterAIModels();
          const virtualConn = {
            id: node.id,
            name: node.name || baseUrl,
            provider: 'routerai',
            isActive: true,
            apiKey: node.apiKey || '',
          };
          for (const model of models) {
            allTests.push({ connection: virtualConn, provider: 'routerai', endpoint: baseUrl, model, apiKey: node.apiKey || '' });
          }
          continue;
        }
        const provider = node.type === 'anthropic-compatible' ? 'anthropic' : 'openai';
        const models = await this._discoverOpenAIModels(baseUrl);
        // Treat node as a virtual connection with its baseUrl as endpoint
        const virtualConn = {
          id: node.id,
          name: node.name || baseUrl,
          provider: node.type,
          isActive: true,
          apiKey: node.apiKey || '',
        };
        for (const model of models) {
          allTests.push({ connection: virtualConn, provider, endpoint: baseUrl, model, apiKey: node.apiKey || '' });
        }
      }
    }

    const EMBEDDING_KEYWORDS = ['embed', 'nomic', 'bge', 'e5-', 'minilm', 'mpnet', 'gte'];
    function isEmbeddingModel(modelName) {
      const name = modelName.toLowerCase();
      return EMBEDDING_KEYWORDS.some(k => name.includes(k));
    }

    this._progress.push({ phase: 'discovery', total: allTests.length, done: 0 });
    const scored = [];

    for (let i = 0; i < allTests.length; i++) {
      const t = allTests[i];
      this._progress[0].done = i + 1;

      // Пропускаем embedding-модели — они не поддерживают generate/chat
      if (isEmbeddingModel(t.model)) {
        scored.push({
          model: t.model,
          provider: t.provider,
          connectionId: t.connection.id,
          connectionName: t.connection.name,
          status: 'error',
          error: 'Embedding model — does not support chat/generate',
          scores: {},
          avgScore: 0,
        });
        continue;
      }
      try {
        const result = await this._benchmarkModel(t);
        scored.push(result);
      } catch (err) {
        scored.push({
          model: t.model,
          provider: t.provider,
          connectionId: t.connection.id,
          connectionName: t.connection.name,
          status: 'error',
          error: err.message,
          scores: {},
          avgScore: 0,
        });
      }
    }

    this.results = scored;
    this._progress.push({ phase: 'config', done: 1, total: 1 });
    const config = this._generateConfig(scored);

    try {
      const modelRouter = await import('./modelRouter.js');
      modelRouter.modelRouter.setScannerResults(scored);
      console.log('[ModelScanner] Scanner results cached in ModelRouter');
    } catch (e) {
      console.log('[ModelScanner] Failed to import ModelRouter:', e.message);
    }

    await this._recordScanUsage();

    return { models: scored, config };
    } finally {
      this._scanInProgress = false;
    }
  }

  async _discoverModels(conn, provider) {
    if (provider === 'ollama') {
      return this._discoverOllamaModels();
    }
    if (provider === 'opencode') {
      return this._discoverOpenCodeFreeModels();
    }
    if (provider === 'opencode-go') {
      return this._getGoModels();
    }
    if (provider === 'routerai') {
      return this._discoverRouterAIModels();
    }
    if (provider === 'openai' && conn.endpoint) {
      const discovered = await this._discoverOpenAIModels(conn.endpoint);
      if (discovered.length > 0) return discovered;
    }
    if (provider === 'groq' || provider === 'xai' || provider === 'sambanova' || provider === 'scaleway' || provider === 'ai21' || provider === 'upstage' || provider === 'huggingface') {
      const endpoint = PROVIDER_ENDPOINTS[provider];
      if (endpoint) {
        const discovered = await this._discoverOpenAIModels(endpoint);
        if (discovered.length > 0) return discovered;
      }
    }
    if (conn.models && conn.models.length > 0) {
      return conn.models.map(m => typeof m === 'string' ? m : (m.id || m.model));
    }
    return [];
  }

  async _discoverOllamaModels() {
    const all = [];
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        for (const m of (data.models || [])) all.push(m.name);
      }
    } catch {}

    try {
      const cloudUrl = 'https://ollama.com/api/tags';
      const cloudRes = await fetch(cloudUrl, { signal: AbortSignal.timeout(5000) });
      if (cloudRes.ok) {
        const data = await cloudRes.json();
        for (const m of (data.models || [])) {
          const name = (m.name || m.id || m.model);
          if (name) all.push(name.includes(':cloud') ? name : `${name}:cloud`);
        }
      }
    } catch {}

    return all;
  }

  async _discoverOpenAIModels(baseUrl) {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/models`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const models = data.data || data.models || [];
        if (Array.isArray(models)) {
          return models.map(m => m.id || m.name || m.model).filter(Boolean);
        }
      }
    } catch {}
    return [];
  }

  async _discoverRouterAIModels() {
    try {
      const res = await fetch('https://routerai.ru/api/v1/models', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const allModels = data.data || data.models || [];
        if (Array.isArray(allModels)) {
          // RouterAI API возвращает ВСЕ модели провайдера, но у пользователя
          // есть доступ только к тем, что разрешены его API-ключом.
          // Без ключа доступна только free модель deepseek/deepseek-v4-flash.
          // Тестировать остальные бессмысленно — они дадут 401.
          return ['deepseek/deepseek-v4-flash'];
        }
      }
    } catch {}
    return ['deepseek/deepseek-v4-flash'];
  }

  async _discoverOpenCodeFreeModels() {
    try {
      const res = await fetch('https://opencode.ai/zen/v1/models', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return (data.data || []).map(m => m.id);
      }
    } catch {}
    return ['north-mini-code-free', 'deepseek-v4-flash-free'];
  }

  _getGoModels() {
    return ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.7-code', 'glm-5.2', 'minimax-m3', 'qwen3.7-max', 'mimo-v2.5'];
  }

  _getFallbackModels(provider) {
    const fallback = {
      routerai: ['deepseek/deepseek-v4-flash'],
      '9router': ['routerai/deepseek/deepseek-v4-flash'],
      opencode: ['north-mini-code-free', 'deepseek-v4-flash-free', 'big-pickle', 'mimo-v2.5-free', 'nemotron-3-ultra-free', 'qwen3.6-plus', 'minimax-m3'],
      'opencode-go': this._getGoModels(),
      openrouter: [],
      groq: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'],
      xai: ['grok-4', 'grok-4-fast-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-2-image-1212'],
      sambanova: ['deepseek-v3.1', 'deepseek-v3.2', 'gemma-4-31b-it', 'gpt-oss-120b', 'meta-llama-3.3-70b-instruct', 'minimax-m2.7'],
      scaleway: ['gemma-3-27b-it', 'llama-3.3-70b-instruct', 'deepseek-v3.2', 'gpt-oss-120b', 'qwen3.6-35b-a3b'],
      ai21: ['jamba-large', 'jamba-mini', 'jamba-1.5-large', 'jamba-1.5-mini'],
      upstage: ['solar-pro', 'solar-mini'],
      huggingface: ['Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
      openai: [],
    };
    return fallback[provider] || [];
  }

  async _benchmarkModel({ connection, provider, endpoint, model, apiKey }) {
    const start = Date.now();
    const result = {
      model, provider,
      connectionId: connection.id,
      connectionName: connection.name,
      status: 'ok',
      latencyMs: 0,
      scores: {},
      costPer1K: this._estimateCost(provider, model),
      capabilities: this._classifyCapabilities(provider, model),
      contextWindow: this._getContextWindow(provider, model),
      error: null,
    };

    if (provider === 'ollama') {
      const ping = await this._pingOllama(model);
      result.latencyMs = ping.latencyMs;
      result.scores.chat = ping.score;
      result.scores.code = ping.codeScore;
      result.scores.reasoning = ping.reasoningScore;
      result.avgScore = (result.scores.chat + result.scores.code + result.scores.reasoning) / 3;
      result.tier = 'free';
      return result;
    }

    const base = endpoint || PROVIDER_ENDPOINTS[provider];
    if (!base) {
      result.status = 'error';
      result.error = 'No endpoint';
      return result;
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    };
    if (provider === 'opencode') {
      headers['Authorization'] = 'Bearer public';
    }
    if (provider === 'opencode-go') {
      headers['Authorization'] = `Bearer ${apiKey || process.env.PROVIDER_OPENCODE_KEY || ''}`;
    }

    const scores = {};
    const benchmarks = [
      { key: 'chat', prompt: BENCHMARK_CHAT },
      { key: 'reasoning', prompt: BENCHMARK_REASONING },
    ];

    if (result.capabilities.includes('code')) {
      benchmarks.push({ key: 'code', prompt: BENCHMARK_CODE });
    }

    for (const b of benchmarks) {
      try {
        const res = await this._callModel(base, headers, model, b.prompt, provider === 'opencode');
        scores[b.key] = this._scoreResponse(b.prompt, res, b.key);
      } catch {
        scores[b.key] = 0;
      }
    }

    result.latencyMs = Date.now() - start;
    result.scores = scores;

    const vals = Object.values(scores).filter(v => v !== undefined);
    result.avgScore = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : 0;

    result.tier = result.costPer1K > 0 ? 'paid' : 'free';

    return result;
  }

  async _recordScanUsage() {
    try {
      const { getAdapter } = await import('@/lib/db/driver.js');
      const db = await getAdapter();
      const now = new Date().toISOString();
      const insert = typeof db.prepare === 'function'
        ? db.prepare(`INSERT INTO usageHistory(provider, model, connectionId, status, cost, promptTokens, completionTokens, meta, timestamp)
                       VALUES(?, ?, ?, ?, 0, 0, 0, ?, ?)`)
        : null;
      if (!insert) return;

      for (const r of this.results) {
        if (!r.connectionId) continue;
        const meta = JSON.stringify({
          latencyMs: r.latencyMs,
          error: r.error || null,
          scores: r.scores,
          avgScore: r.avgScore,
          source: 'modelScanner',
        });
        try {
          insert.run(r.provider || 'unknown', r.model, r.connectionId, r.status, meta, now);
        } catch { /* ignore duplicate */ }
      }
      console.log(`[ModelScanner] Recorded ${this.results.filter(r => r.connectionId).length} test results in usageHistory`);
    } catch (err) {
      console.warn('[ModelScanner] Failed to record usage:', err.message);
    }
  }

  async _callModel(base, headers, model, prompt, isOpenCode) {
    const url = `${base}/chat/completions`;
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0,
      stream: false,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.substring(0, 100)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async _pingOllama(model) {
    const isCloud = model.includes(':cloud') || model.includes('-cloud');
    const baseUrl = isCloud
      ? (process.env.OLLAMA_CLOUD_URL || 'https://ollama.com')
      : (process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
    const cleanModel = model.replace(/:(cloud|-cloud)$/i, '');
    const start = Date.now();
    const scores = { latencyMs: 0, score: 0, codeScore: 0, reasoningScore: 0 };

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cleanModel, prompt: BENCHMARK_CHAT, stream: false, options: { num_predict: 20 } }),
        signal: AbortSignal.timeout(30000),
      });
      scores.latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        scores.score = this._scoreResponse(BENCHMARK_CHAT, data.response || '', 'chat');
      }
    } catch { scores.latencyMs = Date.now() - start; }

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cleanModel, prompt: BENCHMARK_CODE, stream: false, options: { num_predict: 200 } }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        scores.codeScore = this._scoreResponse(BENCHMARK_CODE, data.response || '', 'code');
      }
    } catch {}

    return scores;
  }

  _scoreResponse(prompt, response, type) {
    if (!response || response.length < 3) return 0;
    let score = 0.5;

    if (type === 'code') {
      if (response.includes('```')) score += 0.3;
      if (response.includes('def ') || response.includes('function')) score += 0.1;
      if (response.includes('range(') || response.includes('len(')) score += 0.1;
      if (response.length > 100) score += 0.1;
    } else {
      if (response.length > 10) score += 0.1;
      if (response.length > 50) score += 0.1;
      if (!response.includes('ошибк') && !response.includes('error')) score += 0.1;
    }

    if (response.length < 5) score -= 0.3;
    if (/не знаю|не могу|извини/i.test(response)) score -= 0.2;

    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }

  _estimateCost(provider, model) {
    if (provider === 'opencode') return 0;
    if (provider === 'ollama') return 0;
    if (provider === 'opencode-go') {
      const costs = {
        'deepseek-v4-pro': 0.004,
        'deepseek-v4-flash': 0.001,
        'kimi-k2.7-code': 0.005,
        'glm-5.2': 0.003,
        'minimax-m3': 0.004,
        'qwen3.7-max': 0.006,
        'mimo-v2.5': 0.002,
      };
      return costs[model] || 0.001;
    }
    return 0.001;
  }

  _classifyCapabilities(provider, model) {
    const name = model.toLowerCase();
    const caps = ['chat'];

    if (name.includes('coder') || name.includes('codestral') || name.includes('deepseek-coder') || name.includes('kimi') || name.includes('code') || name.includes('deepseek') || name.includes('grok-code') || name.includes('grok-4') || name.includes('grok-3')) {
      caps.push('code');
    }
    if (name.includes('vision') || name.includes('llava') || name.includes('vl') || name.includes('minimax-m3') || name.includes('gemini') || name.includes('qwen') || name.includes('grok-2-image')) {
      caps.push('vision');
    }
    if (name.includes('deepseek') || name.includes('qwen') || name.includes('llama') || name.includes('glm') || name.includes('kimi') || name.includes('grok') || name.includes('llama')) {
      caps.push('reasoning');
    }
    if (name.includes('embed')) {
      caps.push('embeddings');
    }
    if (name.includes('north')) {
      caps.push('code');
    }

    const sizeMatch = name.match(/(\d+)b/);
    if (sizeMatch && parseInt(sizeMatch[1]) >= 14) {
      caps.push('code_review');
    }

    return caps;
  }

  _getContextWindow(provider, model) {
    try {
      const caps = getCapabilitiesForModel(provider, model);
      return caps?.contextWindow || 0;
    } catch {
      return 0;
    }
  }

  _generateConfig(scored) {
    const groups = { chat: [], code: [], code_review: [], vision: [], web_search: [] };
    const working = scored.filter(m => m.status === 'ok' && m.avgScore > 0);

    for (const m of working) {
      for (const cap of m.capabilities) {
        if (groups[cap]) {
          groups[cap].push({
            model: m.model,
            provider: m.provider,
            priority: Math.round((1 - m.avgScore) * 10) + 1,
            avgScore: m.avgScore,
            latencyMs: m.latencyMs,
            costPer1K: m.costPer1K,
            tier: m.tier,
          });
        }
      }
      if (!m.capabilities.includes('vision') && !m.capabilities.includes('embeddings')) {
        groups.web_search.push({
          model: m.model, provider: m.provider,
          priority: Math.round((1 - m.avgScore) * 10) + 1,
          avgScore: m.avgScore, latencyMs: m.latencyMs,
          costPer1K: m.costPer1K, tier: m.tier,
        });
      }
    }

    for (const [name, models] of Object.entries(groups)) {
      groups[name] = models
        .filter((m, i, arr) => arr.findIndex(x => x.model === m.model && x.provider === m.provider) === i)
        .sort((a, b) => {
          if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
          if (a.avgScore !== b.avgScore) return b.avgScore - a.avgScore;
          return a.latencyMs - b.latencyMs;
        });
    }

    const modelGroups = {};
    for (const [name, models] of Object.entries(groups)) {
      modelGroups[name] = {
        models: models.map(m => ({
          id: m.model,
          provider: m.provider,
          priority: m.priority,
          costPer1K: m.costPer1K,
          tier: m.tier,
        })),
        strategy: name === 'chat' || name === 'web_search' ? 'round_robin' : 'priority',
        fallbackModel: models[0]?.model || null,
        enabled: models.length > 0,
      };
    }

    const best = working.sort((a, b) => b.avgScore - a.avgScore)[0];

    return {
      strategy: 'conditional',
      modelGroups,
      switching: {
        enabled: true,
        preferFreeModels: true,
        maxConsecutiveFreeRequests: 10,
        smartRotation: true,
        timeBasedRules: [
          { from: '00:00', to: '07:59', preferFree: true },
          { from: '08:00', to: '23:59', preferQuality: true, minQualityScore: 0.6 },
        ],
      },
      supervisor: best ? {
        model: best.model,
        provider: best.provider,
        score: best.avgScore,
      } : null,
      ranking: working.map(m => ({
        model: m.model,
        provider: m.provider,
        avgScore: m.avgScore,
        latencyMs: m.latencyMs,
        tier: m.tier,
        capabilities: m.capabilities,
        scores: m.scores,
        costPer1K: m.costPer1K,
      })).sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
        return b.avgScore - a.avgScore;
      }),
    };
  }

  _normalizeProvider(name) {
    if (!name) return name;
    const lower = name.toLowerCase();
    const known = ['routerai', 'opencode', 'openrouter', 'cloudflare', '9router', 'vercel', 'ollama'];
    for (const p of known) {
      if (lower === p || lower.startsWith(p + '-') || lower.startsWith(p + '_')) return p;
    }
    if (lower.startsWith('opencode-go')) return 'opencode-go';
    // OpenAI-compatible узлы не маппим в 'openai' — реальный провайдер определяется по endpoint
    if (lower.startsWith('openai-compatible')) return lower;
    const base = lower.split(/[-_]/)[0];
    if (known.includes(base)) return base;
    return lower;
  }
}

export const modelScanner = new ModelScanner();
