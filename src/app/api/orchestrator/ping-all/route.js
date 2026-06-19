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
  opencode: 'https://api.open-code.dev/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  '9router': `http://localhost:${process.env.PORT || 20128}`, // self — uses local API
  vercel: 'https://api.vercel.ai/v1',
  ollama: 'http://localhost:11434',
  'cloudflare-ai': 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  'ollama-local': 'http://localhost:11434',
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
  const knownProviders = ['routerai', 'opencode', 'cloudflare', '9router', 'vercel', 'ollama'];
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
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  'perplexity': 'https://api.perplexity.ai',
};

// Free models to test per provider
const TEST_MODELS = {
  routerai: [
    'deepseek/deepseek-v4-flash',
    'google/gemma-4-27b-it',
    'qwen/qwen3-30b-a3b',
    'mistralai/mistral-small-latest',
  ],
  opencode: [
    'deepseek/deepseek-chat',
    'google/gemini-2.5-flash-preview',
  ],
  cloudflare: [
    'meta-llama/llama-3.3-70b-instruct',
  ],
  '9router': [
    'deepseek/deepseek-v4-flash',
  ],
  vercel: [
    'openai/gpt-4o-mini',
  ],
  ollama: [], // will be discovered dynamically
};

// Default test models for providers without specific test model list
const DEFAULT_TEST_MODELS = {
  openai: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-haiku-20240307', 'claude-3-5-haiku-latest'],
  google: ['gemini-2.0-flash', 'gemini-2.5-flash-preview'],
  deepseek: ['deepseek-chat', 'deepseek/deepseek-chat'],
  mistral: ['mistral-small-latest', 'open-mistral-nemo'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
};

const TEST_PROMPT = 'Ответь одним словом: работаю';

async function discoverOllamaModels() {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  } catch {
    return [];
  }
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
  } catch (err) {
    result.latencyMs = Date.now() - start;
    result.error = err.message || 'Unknown error';
  }

  return result;
}

async function recordTestInUsage(db, results) {
  try {
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Check if db has a prepare method (BetterSQLite3) or not
    if (typeof db.prepare !== 'function') {
      // Try db.exec or db.run directly
      console.warn('[ping-all] db.prepare not a function, trying alternate recording method');
      for (const r of results) {
        if (r.connectionId && r.status === 'ok') {
          try {
            if (typeof db.run === 'function') {
              await db.run(
                `INSERT INTO usageHistory (connectionId, model, date, requests, inputTokens, outputTokens, cost, createdAt, updatedAt)
                 VALUES (?, ?, ?, 1, 10, 10, 0, ?, ?)
                 ON CONFLICT(connectionId, model, date)
                 DO UPDATE SET requests = requests + 1, updatedAt = ?`,
                [r.connectionId, r.model, today, now, now, now]
              );
            }
          } catch { /* ignore */ }
        }
      }
      return;
    }

    // Insert into usageHistory for each successful test
    const insert = db.prepare(`
      INSERT INTO usageHistory (connectionId, model, date, requests, inputTokens, outputTokens, cost, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, 10, 10, 0, ?, ?)
      ON CONFLICT(connectionId, model, date)
      DO UPDATE SET requests = requests + 1, updatedAt = ?
    `);

    for (const r of results) {
      if (r.connectionId && r.status === 'ok') {
        try {
          insert.run(r.connectionId, r.model, today, now, now, now);
        } catch { /* ignore individual insert errors */ }
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

      const providerData = typeof conn.data === 'string' ? JSON.parse(conn.data) : conn.data;
      const apiKey = providerData?.apiKey || '';
      const endpoint = providerData?.endpoint || '';

      // Нормализуем provider name (openai-compatible-chat-xxx → openai, cloudflare-ai → cloudflare, etc.)
      const normalizedProvider = normalizeProvider(conn.provider);

      // If connection has no explicit endpoint, infer from provider patterns
      const resolvedEndpoint = endpoint || PROVIDER_ENDPOINTS[conn.provider] || PROVIDER_ENDPOINTS[normalizedProvider] || PROVIDER_API_PATTERNS[normalizedProvider] || '';

      // Get models: specific test models for known providers, or default models
      let models = TEST_MODELS[conn.provider] || TEST_MODELS[normalizedProvider];
      if (!models || models.length === 0) {
        models = DEFAULT_TEST_MODELS[normalizedProvider] || [];
      }

      // For providers with no configured endpoint at all, skip them
      if (!resolvedEndpoint) {
        const errMsg = `[ping-all] ❌ ${conn.provider} (normalized: ${normalizedProvider}): No endpoint configured — add endpoint in provider settings`;
        console.error(errMsg);
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name,
          model: models[0] || 'unknown',
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

    // Add Ollama tests
    for (const model of ollamaModels) {
      tests.push({
        provider: 'ollama',
        connectionId: 'ollama-local',
        connectionName: 'Ollama (локальный)',
        apiKey: '',
        endpoint: '',
        model,
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
      // Return working models for auto-config
      workingModels: ok.map(r => ({
        provider: r.provider,
        connectionId: r.connectionId,
        model: r.model,
        latencyMs: r.latencyMs,
      })),
    });
  } catch (error) {
    console.error('[ping-all] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}