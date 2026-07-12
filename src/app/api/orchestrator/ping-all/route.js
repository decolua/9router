/**
 * POST /api/orchestrator/ping-all
 *
 * Прозванивает все активные провайдеры из БД.
 * Для каждого отправляет тестовый запрос и возвращает результаты.
 * Записывает результаты в usageHistory для статистики.
 */

import { NextResponse } from 'next/server';
import { getProviderConnections, getProviderNodes } from '@/lib/localDb';
import { getAdapter } from '@/lib/db/driver.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 min max

// Known provider base endpoints (defaults when connection data has no endpoint)
const PROVIDER_ENDPOINTS = {
  routerai: 'https://routerai.ru/api/v1',
  opencode: 'https://opencode.ai/zen/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  '9router': `http://localhost:${process.env.PORT || 20128}/api/v1`,
  ollama: 'https://api.ollama.com',
  'ollama-cloud': 'https://ollama.com',
  'ollama-local': 'http://localhost:11434',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * Нормализует provider name: убирает суффиксы -<uuid>, -ai, -local, -chat
 * и приводит к базовому имени провайдера.
 * Например: openai-compatible-chat-fa3cc1b2 → openai
 *           cloudflare-ai → cloudflare
 *           ollama-local → ollama
 *           9router → 9router
 *           routerai → routerai
 *           opencode → opencode
 *           vercel → vercel
 */
function normalizeProvider(name) {
  if (!name) return name;
  const lower = name.toLowerCase();
  
  // Exact matches first
  const knownProviders = ['routerai', 'opencode', 'openrouter', 'cloudflare', '9router', 'vercel', 'ollama'];
  for (const p of knownProviders) {
    if (lower === p || lower.startsWith(p + '-') || lower.startsWith(p + '_')) return p;
  }
  if (lower.startsWith('opencode-go')) return 'opencode-go';
  
  // OpenAI-compatible узлы не маппим в 'openai' — реальный провайдер определяется по endpoint
  if (lower.startsWith('openai-compatible')) return lower;
  
  // Fallback: take first part before hyphens/underscores
  const base = lower.split(/[-_]/)[0];
  if (knownProviders.includes(base)) return base;
  
  return lower;
}

// Provider-specific endpoint patterns for OpenAI-compatible APIs
const PROVIDER_API_PATTERNS = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

// Free models to test per provider — динамически расширяется
const TEST_MODELS = {
  routerai: [
    'deepseek/deepseek-v4-flash',
  ],
  opencode: [
    'north-mini-code-free',
    'deepseek-v4-flash-free',
    'big-pickle',
    'mimo-v2.5-free',
    'nemotron-3-ultra-free',
    'qwen3.6-plus',
    'minimax-m3',
  ],
  'opencode-go': [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'kimi-k2.7-code',
    'glm-5.2',
    'minimax-m3',
    'qwen3.7-max',
    'mimo-v2.5',
  ],
  '9router': [
    'routerai/deepseek/deepseek-v4-flash',
  ],
  ollama: [], // will be discovered dynamically (local + cloud)
  openrouter: [],
};

// Default test models for free-only providers
const DEFAULT_TEST_MODELS = {
  openrouter: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwq-32b'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  google: ['gemini-2.0-flash', 'gemini-2.5-flash-preview'],
};

const TEST_PROMPT = 'Ответь одним словом: работаю';

// Free providers priority chain (free first, paid fallback last)
const FREE_PRIORITY_CHAIN = ['opencode', 'ollama', 'openai', 'routerai', 'openai-compatible'];

// Persistent failure tracking — survives module reloads via global
if (!global._pingFailureCount) global._pingFailureCount = new Map();
const failureCount = global._pingFailureCount;

// Progress tracking for client-side progress bar
if (!global._pingProgress) global._pingProgress = { total: 0, completed: 0, current: "", status: "idle" };
const pingProgress = global._pingProgress;

function shouldSkipModel(modelId) {
  if (!modelId) return true;
  const failCount = failureCount.get(modelId) || 0;
  return failCount >= 3; // skip after 3 consecutive failures
}

function recordFailure(modelId, isTimeout) {
  if (isTimeout) {
    failureCount.set(modelId, (failureCount.get(modelId) || 0) + 1);
  } else {
    failureCount.set(modelId, 0); // non-timeout error resets counter
  }
}

function recordSuccess(modelId) {
  failureCount.set(modelId, 0); // success resets
}

async function discoverOllamaModels() {
  const all = [];
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      for (const m of (data.models || [])) all.push({ name: m.name, source: 'local' });
    }
  } catch { /* ignore */ }
  try {
    const cloudRes = await fetch('https://ollama.com/api/tags', { signal: AbortSignal.timeout(5000) });
    if (cloudRes.ok) {
      const data = await cloudRes.json();
      for (const m of (data.models || [])) {
        const name = m.name || m.id || m.model;
        if (name) all.push({ name: name.includes(':cloud') ? name : `${name}:cloud`, source: 'cloud' });
      }
    }
  } catch { /* ignore */ }
  return all;
}

async function discoverOpenAIModels(baseUrl) {
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
  } catch { /* ignore */ }
  return [];
}

async function pingProvider(provider, apiKey, endpoint, model) {
  const start = Date.now();
  const result = { provider, model, status: 'error', latencyMs: 0, response: '', error: null };

  try {
    let url, headers, body;

    if (provider === 'ollama') {
      // Ollama uses its own API — local vs cloud endpoint
      const isCloud = model.includes(':cloud') || model.includes('-cloud');
      const baseUrl = isCloud
        ? (process.env.OLLAMA_CLOUD_URL || 'https://ollama.com')
        : (process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
      url = `${baseUrl}/api/generate`;
      headers = { 'Content-Type': 'application/json' };
      if (isCloud) {
        const cloudKey = apiKey || process.env.PROVIDER_OLLAMA_KEY || '';
        if (cloudKey) headers['Authorization'] = `Bearer ${cloudKey}`;
      }
      body = JSON.stringify({ model: model.replace(/:(cloud|-cloud)$/i, ''), prompt: TEST_PROMPT, stream: false, options: { num_predict: 20 } });
    } else {
      // OpenAI-compatible
      const base = endpoint || PROVIDER_ENDPOINTS[provider] || '';
      if (!base) {
        result.error = 'No endpoint configured';
        return result;
      }
      url = `${base}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      };
      body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: 20,
        temperature: 0,
        stream: false,
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30000), // 30s timeout per request
    });

    result.latencyMs = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      result.error = `HTTP ${res.status}: ${errText.substring(0, 200)}`;
      return result;
    }

    const data = await res.json();

    if (provider === 'ollama') {
      result.response = data.response?.substring(0, 100) || '';
    } else {
      result.response = data.choices?.[0]?.message?.content?.substring(0, 100) || '';
    }

    result.status = 'ok';
    recordSuccess(model);
  } catch (err) {
    result.latencyMs = Date.now() - start;
    result.error = err.message || 'Unknown error';
    const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timed out') || err.message?.includes('aborted');
    recordFailure(model, isTimeout);
  }

  return result;
}

async function recordTestInUsage(db, results) {
  try {
    const now = new Date().toISOString();
    const insert = typeof db.prepare === 'function'
      ? db.prepare(`INSERT INTO usageHistory(provider, model, connectionId, status, cost, promptTokens, completionTokens, meta, timestamp)
                     VALUES(?, ?, ?, ?, 0, 0, 0, ?, ?)`)
      : null;

    for (const r of results) {
      if (!r.connectionId) continue;
      const meta = JSON.stringify({ latencyMs: r.latencyMs, error: r.error || null });
      if (insert) {
        try { insert.run(r.provider || 'unknown', r.model, r.connectionId, r.status, meta, now); } catch { /* ignore */ }
      } else if (typeof db.run === 'function') {
        try {
          await db.run(
            `INSERT INTO usageHistory(provider, model, connectionId, status, cost, promptTokens, completionTokens, meta, timestamp)
             VALUES(?, ?, ?, ?, 0, 0, 0, ?, ?)`,
            [r.provider || 'unknown', r.model, r.connectionId, r.status, meta, now]
          );
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn('[ping-all] Failed to record usage:', err.message);
  }
}

export async function POST() {
  try {
    const connections = await getProviderConnections();
    const results = [];

    // Discover Ollama models
    const ollamaModels = await discoverOllamaModels();

    // Discover models from providerNodes (LM Studio, OpenAI-compatible, etc.)
    // Если endpoint ноды совпадает с существующим connection — используем его TEST_MODELS,
    // а не полный discovery (чтобы не тестить 500 моделей с 401).
    const selfBaseUrl = `http://localhost:${process.env.PORT || 20128}`;
    const nodes = await getProviderNodes();
    const nodeModels = [];
    for (const node of nodes) {
      if (node.type === 'openai-compatible' || node.type === 'anthropic-compatible') {
        const baseUrl = (node.baseUrl || '').replace(/\/+$/, '');
        if (!baseUrl) continue;

        // Пропускаем селф-тест самой 9Router
        if (baseUrl === selfBaseUrl || baseUrl === `${selfBaseUrl}/api/v1`) {
          console.log(`[ping-all] ⏭ Skipping self-test node "${node.name}"`);
          continue;
        }

        // Ищем matching connection по endpoint
        const matchingConn = connections.find(c => {
          const ep = (c.endpoint || c.providerSpecificData?.baseUrl || c.baseUrl || '').replace(/\/+$/, '');
          return ep === baseUrl;
        });

        let discovered;
        if (matchingConn) {
          const normProvider = normalizeProvider(matchingConn.provider);
          discovered = TEST_MODELS[matchingConn.provider] || TEST_MODELS[normProvider] || [];
          if (discovered.length === 0) {
            // Для кастомных openai-compatible нод (LM Studio) не используем DEFAULT_TEST_MODELS
            // а делаем полный discovery реальных моделей из /models эндпоинта
            if (matchingConn.provider && matchingConn.provider.startsWith('openai-compatible')) {
              console.log(`[ping-all] ℹ️  Custom OpenAI-compatible node "${node.name}" — doing full discovery from /models`);
              discovered = await discoverOpenAIModels(baseUrl);
            } else {
              discovered = DEFAULT_TEST_MODELS[normProvider] || [];
            }
          }
          console.log(`[ping-all] ℹ️  ProviderNode "${node.name}" matches connection "${matchingConn.provider}" — using ${discovered.length} models`);
        } else {
          // Незнакомый endpoint — полное discovery (LM Studio, etc.)
          discovered = await discoverOpenAIModels(baseUrl);
        }

        for (const model of discovered) {
          nodeModels.push({
            provider: node.type,
            providerDisplay: node.name || baseUrl,
            connectionId: node.id,
            connectionName: node.name || baseUrl,
            apiKey: node.apiKey || '',
            endpoint: baseUrl,
            model,
          });
        }
      }
    }

    // Build test list
    const tests = [];

    for (const conn of connections) {
      if (!conn.isActive) continue;

      const apiKey = conn.apiKey || '';
      const endpoint = conn.endpoint || conn.providerSpecificData?.baseUrl || conn.baseUrl || '';

      // Нормализуем provider name (openai-compatible-chat-xxx → openai, cloudflare-ai → cloudflare, etc.)
      const normalizedProvider = normalizeProvider(conn.provider);

      // If connection has no explicit endpoint, infer from provider patterns
      const resolvedEndpoint = endpoint || PROVIDER_ENDPOINTS[conn.provider] || PROVIDER_ENDPOINTS[normalizedProvider] || PROVIDER_API_PATTERNS[normalizedProvider] || '';

      // Get models: specific test models for known providers, or default models
      let models = TEST_MODELS[conn.provider] || TEST_MODELS[normalizedProvider];
      if (!models || models.length === 0) {
        // Для OpenCode Go, если нет specific моделей, пробуем наши
        if (normalizedProvider === 'opencode' || normalizedProvider === 'ocg') {
          models = TEST_MODELS[normalizedProvider] || [];
          if (models.length === 0) {
            // Fallback to known good models
            if (normalizedProvider === 'opencode') {
              models = ['north-mini-code-free', 'deepseek-v4-flash-free'];
            } else if (normalizedProvider === 'ocg') {
              models = ['deepseek-v4-flash', 'deepseek-v4-pro'];
            }
          }
        }
      }
      // Match custom nodes by connection name
      if (!models || models.length === 0) {
        const nameKey = (conn.name || '').toLowerCase().replace(/[\s_-]+/g, '-');
        models = TEST_MODELS[nameKey];
      }
      if (!models || models.length === 0) {
        // Skip default models for custom OpenAI-compatible nodes — у каждого свои модели
        const isCustomNode = conn.provider && (
          conn.provider.startsWith('openai-compatible') ||
          conn.provider.startsWith('anthropic-compatible') ||
          conn.provider.startsWith('custom-embedding')
        );
        if (!isCustomNode) {
          models = DEFAULT_TEST_MODELS[normalizedProvider] || [];
        }
      }

      // Skip connections with no test models
      if (!models || models.length === 0) {
        continue;
      }

      // For providers with no configured endpoint at all, skip them
      if (!resolvedEndpoint) {
        const errMsg = `[ping-all] ❌ ${conn.provider} (normalized: ${normalizedProvider}): No endpoint configured — add endpoint in provider settings`;
        console.error(errMsg);
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name,
          model: models?.[0] || 'unknown',
          status: 'error',
          latencyMs: 0,
          response: '',
          error: `No endpoint configured for provider "${conn.provider}" — add endpoint in provider settings`,
        });
        continue;
      }

      for (const model of models) {
        tests.push({
          provider: normalizedProvider,
          connectionId: conn.id,
          connectionName: conn.name,
          apiKey,
          endpoint: resolvedEndpoint,
          model,
        });
      }

      // OpenCode Go: если есть ключ, добавляем платные модели
      if (normalizedProvider === 'opencode' && (process.env.PROVIDER_OPENCODE_KEY || '').trim()) {
        const goModels = TEST_MODELS['opencode-go'] || [];
        const goEndpoint = 'https://opencode.ai/zen/go/v1';
        const goKey = process.env.PROVIDER_OPENCODE_KEY.trim();
        for (const model of goModels) {
          tests.push({
            provider: 'opencode-go',
            connectionId: conn.id,
            connectionName: conn.name,
            apiKey: goKey,
            endpoint: goEndpoint,
            model,
          });
        }
      }
    }

    // Add Ollama tests (skip models with 3+ consecutive failures)
    // Find Ollama connection's API key from DB connections
    const ollamaConn = connections.find(c => {
      const norm = normalizeProvider(c.provider);
      return norm === 'ollama' || norm === 'ollama-local';
    });
    const ollamaApiKey = ollamaConn?.apiKey || process.env.PROVIDER_OLLAMA_KEY || '';
    for (const m of ollamaModels) {
      if (shouldSkipModel(m.name)) {
        console.log(`[ping-all] ⏭ Skipping ${m.name} (${failureCount.get(m.name)} consecutive failures)`);
        results.push({
          provider: 'ollama',
          connectionId: 'ollama-' + m.source,
          connectionName: m.source === 'cloud' ? 'Ollama Cloud' : 'Ollama Local',
          model: m.name,
          status: 'error',
          latencyMs: 0,
          response: '',
          error: `Skipped after ${failureCount.get(m.name)} consecutive failures`,
        });
        continue;
      }
      tests.push({
        provider: 'ollama',
        connectionId: 'ollama-' + m.source,
        connectionName: m.source === 'cloud' ? 'Ollama Cloud' : 'Ollama Local',
        apiKey: m.source === 'cloud' ? ollamaApiKey : '',
        endpoint: '',
        model: m.name,
      });
    }

    // Add providerNode tests (LM Studio, etc.)
    for (const nm of nodeModels) {
      if (shouldSkipModel(nm.model)) continue;
      tests.push({
        provider: nm.provider,
        connectionId: nm.connectionId,
        connectionName: nm.connectionName,
        apiKey: nm.apiKey,
        endpoint: nm.endpoint,
        model: nm.model,
      });
    }

    console.log(`[ping-all] Testing ${tests.length} model endpoints...`);
    pingProgress.total = tests.length;
    pingProgress.completed = 0;
    pingProgress.status = "running";

    // Run all tests in parallel (with concurrency limit of 5)
    const CONCURRENCY = 5;
    for (let i = 0; i < tests.length; i += CONCURRENCY) {
      const batch = tests.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(t => pingProvider(t.provider, t.apiKey, t.endpoint, t.model))
      );

      for (let j = 0; j < batchResults.length; j++) {
        batchResults[j].connectionId = batch[j].connectionId;
        batchResults[j].connectionName = batch[j].connectionName;
        results.push(batchResults[j]);
        pingProgress.completed++;
        pingProgress.current = `${batch[j].provider}/${batch[j].model}`;
        // Log each result
        if (batchResults[j].status === 'ok') {
          console.log(`[ping-all] ✅ ${batch[j].provider}/${batch[j].model}: OK (${batchResults[j].latencyMs}ms)`);
        } else {
          console.error(`[ping-all] ❌ ${batch[j].provider}/${batch[j].model}: ${batchResults[j].error}`);
        }
      }
    }

    pingProgress.status = "done";

    // Record in usage history
    try {
      const db = await getAdapter();
      await recordTestInUsage(db, results);
    } catch (err) {
      console.warn('[ping-all] Usage recording skipped:', err.message);
    }

    // Summary
    const ok = results.filter(r => r.status === 'ok');
    const failed = results.filter(r => r.status !== 'ok');
    const avgLatency = ok.length > 0 ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : 0;

    console.log(`[ping-all] Done: ${ok.length}/${results.length} OK, avg ${avgLatency}ms`);

    // Persist results in SQLite so they survive restarts
    try {
      const db = await getAdapter();
      const now = new Date().toISOString();
      const data = JSON.stringify({
        timestamp: now,
        summary: {
          total: results.length, ok: ok.length, failed: failed.length, avgLatencyMs: avgLatency,
        },
        results: results.map(r => ({
          provider: r.provider, connectionName: r.connectionName, model: r.model,
          status: r.status, latencyMs: r.latencyMs, response: r.response, error: r.error,
        })),
        workingModels: ok.map(r => ({
          provider: r.provider, connectionId: r.connectionId, model: r.model, latencyMs: r.latencyMs,
        })),
      });

      if (typeof db.run === 'function') {
        db.run("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('orchestrator', 'pingLastResults', ?)", [data]);
      }
    } catch (err) {
      console.warn('[ping-all] SQLite persist skipped:', err.message);
    }

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        ok: ok.length,
        failed: failed.length,
        avgLatencyMs: avgLatency,
      },
      results: results.map(r => ({
        provider: r.provider,
        connectionName: r.connectionName,
        model: r.model,
        status: r.status,
        latencyMs: r.latencyMs,
        response: r.response,
        error: r.error,
      })),
      // Return working models for auto-config, ordered by free-first priority
      workingModels: ok.map(r => ({
        provider: r.provider,
        connectionId: r.connectionId,
        model: r.model,
        latencyMs: r.latencyMs,
        tier: FREE_PRIORITY_CHAIN.indexOf(r.provider) >= 0 ? 'free' : 'paid',
      })).sort((a, b) => {
        const aIdx = FREE_PRIORITY_CHAIN.indexOf(a.provider);
        const bIdx = FREE_PRIORITY_CHAIN.indexOf(b.provider);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      }),
    });
  } catch (error) {
    console.error('[ping-all] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}