/**
 * POST /api/orchestrator/ping-all
 *
 * Прозванивает все активные провайдеры из БД.
 * Для каждого отправляет тестовый запрос и возвращает результаты.
 * Записывает результаты в usageHistory для статистики.
 */

import { NextResponse } from 'next/server';
import { getProviderConnections } from '@/lib/localDb';
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
  
  // Try to extract base provider from openai-compatible-chat-xxx
  const openaiMatch = lower.match(/^(openai-compatible-chat)/);
  if (openaiMatch) return 'openai';
  
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

// Free models to test per provider — ТОЛЬКО БЕСПЛАТНЫЕ
const TEST_MODELS = {
  routerai: [
    'deepseek/deepseek-v4-flash',
  ],
  opencode: [
    'north-mini-code-free',
    'deepseek-v4-flash-free',
    'nemotron-3-ultra-free',
  ],
  cloudflare: [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    '@cf/qwen/qwen2.5-coder-32b-instruct',
  ],
  '9router': [
    'routerai/deepseek/deepseek-v4-flash',
  ],
  'lm-studio': [
    'gemma-4-12b-coder-fable5-composer2.5-v1:2',
    'google/gemma-4-e4b',
    'llama-3.2-3b-instruct',
  ],
  ollama: [], // will be discovered dynamically (local + cloud)
  kiro: [
    'claude-sonnet-4.5',
    'glm-5',
    'MiniMax-M2.5',
  ],
  vertex: [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
  ],
  openrouter: [],
};

// Default test models for free-only providers
const DEFAULT_TEST_MODELS = {
  openai: ['gpt-4o-mini-free'],
  openrouter: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  google: ['gemini-2.0-flash', 'gemini-2.5-flash-preview'],
};

const TEST_PROMPT = 'Ответь одним словом: работаю';

// Free providers priority chain (free first, paid fallback last)
const FREE_PRIORITY_CHAIN = ['opencode', 'ollama', 'openai', 'routerai'];

// Persistent failure tracking — survives module reloads via global
if (!global._pingFailureCount) global._pingFailureCount = new Map();
const failureCount = global._pingFailureCount;

function shouldSkipModel(modelId) {
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
  const CLOUD = [
    'minimax-m3:cloud', 'nemotron-3-super:cloud', 'gemma4:31b-cloud',
    'gpt-oss:120b:cloud', 'minimax-m2.5:cloud',
  ];
  for (const m of CLOUD) {
    if (!all.find(x => x.name === m)) all.push({ name: m, source: 'cloud' });
  }
  return all;
}

async function pingProvider(provider, apiKey, endpoint, model) {
  const start = Date.now();
  const result = { provider, model, status: 'error', latencyMs: 0, response: '', error: null };

  try {
    let url, headers, body;

    if (provider === 'ollama') {
      // Ollama uses its own API
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      url = `${baseUrl}/api/generate`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ model, prompt: TEST_PROMPT, stream: false, options: { num_predict: 20 } });
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
        'Authorization': `Bearer ${apiKey}`,
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
          provider: normalizedProvider, // используем нормализованное имя для отправки запроса
          connectionId: conn.id,
          connectionName: conn.name,
          apiKey,
          endpoint: resolvedEndpoint,
          model,
        });
      }
    }

    // Add Ollama tests (skip models with 3+ consecutive failures)
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
        apiKey: '',
        endpoint: '',
        model: m.name,
      });
    }

    console.log(`[ping-all] Testing ${tests.length} model endpoints...`);

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
        // Log each result
        if (batchResults[j].status === 'ok') {
          console.log(`[ping-all] ✅ ${batch[j].provider}/${batch[j].model}: OK (${batchResults[j].latencyMs}ms)`);
        } else {
          console.error(`[ping-all] ❌ ${batch[j].provider}/${batch[j].model}: ${batchResults[j].error}`);
        }
      }
    }

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