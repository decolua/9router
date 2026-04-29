// Usage analytics facade. SQLite-backed on Node; no-op on Workers.
// In-memory pending-request tracker + statsEmitter are preserved exactly
// (same global state, same observable semantics) because consumers subscribe
// to `statsEmitter` events from SSE routes.

import { EventEmitter } from "events";
import fs from "node:fs";
import { getDatabase } from "./sqlite/connection.js";
import { DATA_DIR } from "@/lib/dataDir.js";

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

if (!isCloud && fs?.existsSync && !fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

// ===== Global in-memory state (unchanged semantics) ======================

if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
const pendingRequests = global._pendingRequests;

if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
const lastErrorProvider = global._lastErrorProvider;

if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
export const statsEmitter = global._statsEmitter;

if (!global._pendingTimers) global._pendingTimers = {};
const pendingTimers = global._pendingTimers;

const PENDING_TIMEOUT_MS = 60 * 1000;

// ===== Helpers ===========================================================

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tokensFromEntry(entry) {
  const t = entry.tokens || {};
  return {
    prompt: t.prompt_tokens ?? t.input_tokens ?? 0,
    completion: t.completion_tokens ?? t.output_tokens ?? 0,
  };
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("@/lib/localDb.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    cost += (nonCachedInput * (pricing.input / 1000000));
    if (cachedTokens > 0) {
      const rate = pricing.cached || pricing.input;
      cost += (cachedTokens * (rate / 1000000));
    }
    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += (outputTokens * (pricing.output / 1000000));
    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const rate = pricing.reasoning || pricing.output;
      cost += (reasoningTokens * (rate / 1000000));
    }
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const rate = pricing.cache_creation || pricing.input;
      cost += (cacheCreationTokens * (rate / 1000000));
    }
    return cost;
  } catch (err) {
    console.error("Error calculating cost:", err);
    return 0;
  }
}

// Upsert one (date_key, bucket, key) row, adding the given deltas.
function upsertSummary(db, dateKey, bucket, key, delta, meta = null) {
  db.prepare(`
    INSERT INTO daily_summary
      (date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key, bucket, key) DO UPDATE SET
      requests          = requests + excluded.requests,
      prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
      completion_tokens = completion_tokens + excluded.completion_tokens,
      cost              = cost + excluded.cost,
      data              = COALESCE(excluded.data, data)
  `).run(
    dateKey, bucket, key,
    delta.requests || 0, delta.promptTokens || 0,
    delta.completionTokens || 0, delta.cost || 0,
    meta ? JSON.stringify(meta) : null,
  );
}

function bumpTotalRequests(db) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('totalRequestsLifetime', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(meta.value AS INTEGER) + 1) AS TEXT)
  `).run();
}

function readTotalRequests(db) {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'totalRequestsLifetime'").get();
  return r ? (parseInt(r.value, 10) || 0) : 0;
}

// ===== Pending tracker (in-memory only) ==================================

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(
      0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1),
    );
  }

  if (started) {
    if (!pendingTimers[timerKey]) pendingTimers[timerKey] = [];
    // One timer per started request — decrement only this request, not all.
    const handle = setTimeout(() => {
      const arr = pendingTimers[timerKey] || [];
      const idx = arr.indexOf(handle);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey]--;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey]--;
      }
      statsEmitter.emit("pending");
    }, PENDING_TIMEOUT_MS);
    pendingTimers[timerKey].push(handle);
  } else {
    // Pop one outstanding timer for this key (paired with its start).
    const arr = pendingTimers[timerKey];
    if (arr && arr.length > 0) {
      clearTimeout(arr.pop());
      if (arr.length === 0) delete pendingTimers[timerKey];
    }
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  if (process.env.PENDING_LOG === "true") {
    const t = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    console.log(`[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`);
  }
  statsEmitter.emit("pending");
}

// ===== Write path ========================================================

// In-memory queue of pending daily_summary upserts. usage_history rows still
// inserted synchronously so dashboard real-time view stays accurate.
if (!global._summaryQueue) global._summaryQueue = [];
const summaryQueue = global._summaryQueue;
let summaryFlushTimer = null;
const SUMMARY_BATCH_SIZE = 50;
const SUMMARY_FLUSH_INTERVAL_MS = 500;

function scheduleSummaryFlush() {
  if (summaryFlushTimer) return;
  summaryFlushTimer = setTimeout(flushSummaryQueue, SUMMARY_FLUSH_INTERVAL_MS);
}

function flushSummaryQueue() {
  if (summaryFlushTimer) { clearTimeout(summaryFlushTimer); summaryFlushTimer = null; }
  if (summaryQueue.length === 0) return;
  const batch = summaryQueue.splice(0, summaryQueue.length);
  try {
    const db = getDatabase();
    const run = db.transaction(() => {
      for (const entry of batch) {
        const dateKey = getLocalDateKey(entry.timestamp);
        const vals = {
          requests: 1,
          promptTokens: entry.prompt,
          completionTokens: entry.completion,
          cost: entry.cost,
        };
        upsertSummary(db, dateKey, "day", "_", vals);
        if (entry.provider) upsertSummary(db, dateKey, "byProvider", entry.provider, vals);
        const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
        upsertSummary(db, dateKey, "byModel", modelKey, vals,
          { rawModel: entry.model, provider: entry.provider });
        if (entry.connectionId) {
          upsertSummary(db, dateKey, "byAccount", entry.connectionId, vals,
            { rawModel: entry.model, provider: entry.provider });
        }
        const apiKeyVal = typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
        const akKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
        upsertSummary(db, dateKey, "byApiKey", akKey, vals,
          { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null });
        const endpoint = entry.endpoint || "Unknown";
        const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
        upsertSummary(db, dateKey, "byEndpoint", epKey, vals,
          { endpoint, rawModel: entry.model, provider: entry.provider });
        bumpTotalRequests(db);
      }
    });
    run();
    statsEmitter.emit("update");
  } catch (err) {
    console.error("Failed to flush daily_summary batch:", err?.message || err);
  }
}

export async function saveRequestUsage(entry) {
  if (isCloud) return;

  try {
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const db = getDatabase();
    const { prompt, completion } = tokensFromEntry(entry);
    const cost = entry.cost || 0;

    // Insert usage_history row synchronously (dashboard real-time view).
    db.prepare(`
      INSERT INTO usage_history
      (timestamp, provider, model, connection_id, api_key, endpoint, status,
       prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.provider || null,
      entry.model || null,
      entry.connectionId || null,
      typeof entry.apiKey === "string" ? entry.apiKey : null,
      entry.endpoint || null,
      entry.status || null,
      prompt, completion, cost,
      JSON.stringify({ tokens: entry.tokens || {} }),
    );

    // Defer the 6+ daily_summary upserts to a batched async flush.
    summaryQueue.push({
      timestamp: entry.timestamp,
      provider: entry.provider,
      model: entry.model,
      connectionId: entry.connectionId,
      apiKey: entry.apiKey,
      endpoint: entry.endpoint,
      prompt, completion, cost,
    });
    if (summaryQueue.length >= SUMMARY_BATCH_SIZE) flushSummaryQueue();
    else scheduleSummaryFlush();
  } catch (err) {
    console.error("Failed to save usage stats:", err);
  }
}

// ===== Logs (SQLite-backed, batched async writes) ========================

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Connection-name cache (TTL) — avoids dynamic import + full SELECT per log line
let connectionNameCache = null;
let connectionNameCacheTs = 0;
const CONN_CACHE_TTL_MS = 30_000;

async function getConnectionName(connectionId) {
  if (!connectionId) return "-";
  const now = Date.now();
  if (!connectionNameCache || (now - connectionNameCacheTs) > CONN_CACHE_TTL_MS) {
    try {
      const { getProviderConnections } = await import("@/lib/localDb.js");
      const list = await getProviderConnections();
      connectionNameCache = new Map(list.map(c => [c.id, c.name || c.email || c.id?.slice(0, 8)]));
      connectionNameCacheTs = now;
    } catch {
      connectionNameCache = connectionNameCache || new Map();
    }
  }
  return connectionNameCache.get(connectionId) || connectionId.slice(0, 8);
}

// In-memory log queue, flushed on threshold or interval. Hot path is non-blocking.
const LOG_BATCH_SIZE = 50;
const LOG_FLUSH_INTERVAL_MS = 500;
const LOG_MAX_ROWS = 1000; // trim threshold

if (!global._logQueue) global._logQueue = [];
const logQueue = global._logQueue;
let logFlushTimer = null;
let logTrimCounter = 0;

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL_MS);
}

function flushLogs() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0, logQueue.length);
  try {
    const db = getDatabase();
    const stmt = db.prepare(
      `INSERT INTO request_log (timestamp, model, provider, account, prompt_tokens, completion_tokens, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = db.transaction((rows) => {
      for (const r of rows) stmt.run(r.timestamp, r.model, r.provider, r.account, r.prompt_tokens, r.completion_tokens, r.status);
    });
    insertMany(batch);

    // Periodic trim (keep latest LOG_MAX_ROWS) — runs every ~10 flushes
    logTrimCounter += 1;
    if (logTrimCounter >= 10) {
      logTrimCounter = 0;
      db.prepare(
        `DELETE FROM request_log WHERE id <= (
           SELECT id FROM request_log ORDER BY id DESC LIMIT 1 OFFSET ?
         )`,
      ).run(LOG_MAX_ROWS);
    }
  } catch (err) {
    console.error("Failed to flush request_log:", err?.message || err);
  }
}

export async function appendRequestLog({ model, provider, connectionId, tokens, status }) {
  if (isCloud) return;
  try {
    const account = await getConnectionName(connectionId);
    const promptTokens = tokens?.prompt_tokens ?? null;
    const completionTokens = tokens?.completion_tokens ?? null;
    logQueue.push({
      timestamp: formatLogDate(),
      model: model || "-",
      provider: provider ? provider.toUpperCase() : "-",
      account,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      status: String(status ?? ""),
    });
    if (logQueue.length >= LOG_BATCH_SIZE) flushLogs();
    else scheduleLogFlush();
  } catch (err) {
    console.error("Failed to enqueue request log:", err?.message || err);
  }
}

export async function getRecentLogs(limit = 200) {
  if (isCloud) return [];
  try {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT timestamp, model, provider, account, prompt_tokens, completion_tokens, status
       FROM request_log ORDER BY id DESC LIMIT ?`,
    ).all(limit);
    return rows.map(r => {
      const sent = r.prompt_tokens ?? "-";
      const received = r.completion_tokens ?? "-";
      return `${r.timestamp} | ${r.model || "-"} | ${r.provider || "-"} | ${r.account || "-"} | ${sent} | ${received} | ${r.status || ""}`;
    });
  } catch {
    return [];
  }
}

// ===== Read path =========================================================

function historyRow(r) {
  const blob = r.data ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : {};
  return {
    timestamp: r.timestamp,
    provider: r.provider || "",
    model: r.model || "",
    connectionId: r.connection_id || null,
    apiKey: r.api_key,
    endpoint: r.endpoint,
    status: r.status || "ok",
    tokens: blob.tokens || { prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens },
    cost: r.cost,
  };
}

export async function getUsageHistory(filter = {}) {
  if (isCloud) return [];
  const db = getDatabase();
  const clauses = [];
  const params = [];
  if (filter.provider) { clauses.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { clauses.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { clauses.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { clauses.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM usage_history ${where} ORDER BY timestamp`,
  ).all(...params);
  return rows.map(historyRow);
}

export async function getActiveRequests() {
  if (isCloud) {
    return { activeRequests: [], recentRequests: [], errorProvider: "" };
  }

  const db = getDatabase();

  // Active requests from in-memory pending state
  let connectionMap = {};
  try {
    const { getProviderConnections } = await import("@/lib/localDb.js");
    for (const c of await getProviderConnections()) {
      connectionMap[c.id] = c.name || c.email || c.id;
    }
  } catch {}

  const activeRequests = [];
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
        });
      }
    }
  }

  // Recent requests from last 20 usage_history rows
  const rows = db.prepare(`
    SELECT * FROM usage_history ORDER BY timestamp DESC LIMIT 200
  `).all();
  const seen = new Set();
  const recentRequests = [];
  for (const r of rows) {
    const pt = r.prompt_tokens || 0;
    const ct = r.completion_tokens || 0;
    if (pt === 0 && ct === 0) continue;
    const minute = r.timestamp ? r.timestamp.slice(0, 16) : "";
    const key = `${r.model}|${r.provider}|${pt}|${ct}|${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentRequests.push({
      timestamp: r.timestamp,
      model: r.model,
      provider: r.provider || "",
      promptTokens: pt,
      completionTokens: ct,
      status: r.status || "ok",
    });
    if (recentRequests.length >= 20) break;
  }

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

export async function getUsageStats(period = "all") {
  if (isCloud) {
    return {
      totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0,
      byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      last10Minutes: [], pending: pendingRequests, activeRequests: [],
      recentRequests: [], errorProvider: "",
    };
  }

  const db = getDatabase();
  const { getProviderConnections, getApiKeys, getProviderNodes } = await import("@/lib/localDb.js");

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    for (const n of await getProviderNodes()) {
      if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
    }
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // Recent requests (always live)
  const { recentRequests } = await getActiveRequests();

  const stats = {
    totalRequests: readTotalRequests(db),
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests from pending
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — live history
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const bucketKey = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[bucketKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[bucketKey]);
  }
  const tenMinRows = db.prepare(`
    SELECT timestamp, prompt_tokens, completion_tokens, cost
    FROM usage_history WHERE timestamp >= ?
  `).all(tenMinutesAgo.toISOString());
  for (const r of tenMinRows) {
    const et = new Date(r.timestamp).getTime();
    const bucket = Math.floor(et / 60000) * 60000;
    if (bucketMap[bucket]) {
      bucketMap[bucket].requests++;
      bucketMap[bucket].promptTokens += r.prompt_tokens || 0;
      bucketMap[bucket].completionTokens += r.completion_tokens || 0;
      bucketMap[bucket].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h";

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    let whereClause = "";
    const params = [];
    if (maxDays !== null) {
      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - (maxDays - 1));
      const cutoffKey = getLocalDateKey(cutoff);
      whereClause = "WHERE date_key >= ?";
      params.push(cutoffKey);
    }

    const rows = db.prepare(`
      SELECT date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data
      FROM daily_summary ${whereClause}
    `).all(...params);

    for (const r of rows) {
      const meta = r.data ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : {};
      const prompt = r.prompt_tokens || 0;
      const completion = r.completion_tokens || 0;
      const cost = r.cost || 0;
      const requests = r.requests || 0;

      if (r.bucket === "day") {
        stats.totalPromptTokens += prompt;
        stats.totalCompletionTokens += completion;
        stats.totalCost += cost;
        continue;
      }

      if (r.bucket === "byProvider") {
        if (!stats.byProvider[r.key]) stats.byProvider[r.key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
        const t = stats.byProvider[r.key];
        t.requests += requests; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
      } else if (r.bucket === "byModel") {
        const rawModel = meta.rawModel || r.key.split("|")[0];
        const provider = meta.provider || r.key.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: r.date_key };
        }
        const t = stats.byModel[statsKey];
        t.requests += requests; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byAccount") {
        const connId = r.key;
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: r.date_key };
        }
        const t = stats.byAccount[accountKey];
        t.requests += requests; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byApiKey") {
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = meta.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyKey = apiKeyVal || "local-no-key";
        if (!stats.byApiKey[r.key]) {
          stats.byApiKey[r.key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKey: apiKeyVal, keyName, apiKeyKey, lastUsed: r.date_key };
        }
        const t = stats.byApiKey[r.key];
        t.requests += requests; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byEndpoint") {
        const endpoint = meta.endpoint || r.key.split("|")[0] || "Unknown";
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[r.key]) {
          stats.byEndpoint[r.key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: r.date_key };
        }
        const t = stats.byEndpoint[r.key];
        t.requests += requests; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      }
    }

    // Overlay lastUsed with precise ISO timestamps from usage_history rows
    // (daily_summary only has YYYY-MM-DD granularity).
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const overlayRows = maxDays
      ? db.prepare(
          `SELECT timestamp, provider, model, connection_id AS connectionId,
                  api_key AS apiKey, endpoint
             FROM usage_history WHERE timestamp >= ?`,
        ).all(new Date(overlayCutoff).toISOString())
      : db.prepare(
          `SELECT timestamp, provider, model, connection_id AS connectionId,
                  api_key AS apiKey, endpoint FROM usage_history`,
        ).all();
    for (const entry of overlayRows) {
      const ts = entry.timestamp;
      if (!ts || new Date(ts).getTime() < overlayCutoff) continue;

      const modelKey = entry.provider ? `${entry.model} (${entry.provider})` : entry.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) {
        stats.byModel[modelKey].lastUsed = ts;
      }

      if (entry.connectionId) {
        const accountName = connectionMap[entry.connectionId] || `Account ${entry.connectionId.slice(0, 8)}...`;
        const accountKey = `${entry.model} (${entry.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) {
          stats.byAccount[accountKey].lastUsed = ts;
        }
      }

      const apiKeyKey = (entry.apiKey && typeof entry.apiKey === "string")
        ? `${entry.apiKey}|${entry.model}|${entry.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) {
        stats.byApiKey[apiKeyKey].lastUsed = ts;
      }

      const endpoint = entry.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) {
        stats.byEndpoint[endpointKey].lastUsed = ts;
      }
    }
  } else {
    // 24h: scan usage_history
    const cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    const rows = db.prepare(`
      SELECT * FROM usage_history WHERE timestamp >= ?
    `).all(cutoff);

    for (const r of rows) {
      const prompt = r.prompt_tokens || 0;
      const completion = r.completion_tokens || 0;
      const cost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalPromptTokens += prompt;
      stats.totalCompletionTokens += completion;
      stats.totalCost += cost;

      if (r.provider) {
        if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
        const t = stats.byProvider[r.provider];
        t.requests++; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
      }

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const m = stats.byModel[modelKey];
      m.requests++; m.promptTokens += prompt; m.completionTokens += completion; m.cost += cost;
      if (new Date(r.timestamp) > new Date(m.lastUsed)) m.lastUsed = r.timestamp;

      if (r.connection_id) {
        const accountName = connectionMap[r.connection_id] || `Account ${r.connection_id.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connection_id, accountName, lastUsed: r.timestamp };
        }
        const t = stats.byAccount[accountKey];
        t.requests++; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      }

      if (r.api_key && typeof r.api_key === "string") {
        const keyInfo = apiKeyMap[r.api_key];
        const keyName = keyInfo?.name || r.api_key.slice(0, 8) + "...";
        const apiKeyModelKey = `${r.api_key}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[apiKeyModelKey]) {
          stats.byApiKey[apiKeyModelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: r.api_key, keyName, apiKeyKey: r.api_key, lastUsed: r.timestamp };
        }
        const t = stats.byApiKey[apiKeyModelKey];
        t.requests++; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const t = stats.byApiKey["local-no-key"];
        t.requests++; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const endpointModelKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[endpointModelKey]) {
        stats.byEndpoint[endpointModelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const t = stats.byEndpoint[endpointModelKey];
      t.requests++; t.promptTokens += prompt; t.completionTokens += completion; t.cost += cost;
      if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
    }
  }

  return stats;
}

export async function getChartData(period = "7d") {
  if (isCloud) return [];
  const db = getDatabase();
  const now = Date.now();

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const ts = startTime + i * bucketMs;
      return { label: labelFn(ts), tokens: 0, cost: 0 };
    });

    const rows = db.prepare(`
      SELECT timestamp, prompt_tokens, completion_tokens, cost
      FROM usage_history WHERE timestamp >= ?
    `).all(new Date(startTime).toISOString());

    for (const r of rows) {
      const et = new Date(r.timestamp).getTime();
      if (et < startTime || et > now) continue;
      const idx = Math.min(Math.floor((et - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dayStart = new Date(today);
  dayStart.setDate(dayStart.getDate() - (bucketCount - 1));
  const dayRows = db.prepare(`
    SELECT date_key, prompt_tokens, completion_tokens, cost
    FROM daily_summary
    WHERE bucket = 'day' AND date_key >= ?
  `).all(getLocalDateKey(dayStart));
  const byDate = {};
  for (const r of dayRows) byDate[r.date_key] = r;

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = getLocalDateKey(d);
    const day = byDate[dateKey];
    return {
      label: labelFn(d),
      tokens: day ? (day.prompt_tokens || 0) + (day.completion_tokens || 0) : 0,
      cost: day ? (day.cost || 0) : 0,
    };
  });
}

// Re-export request details for back-compat (existing routes import these
// names from @/lib/usageDb)
export { saveRequestDetail, getRequestDetails, getRequestDetailById } from "./requestDetailsDb.js";
