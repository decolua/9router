import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Rollup pre-aggregation (read-path source of truth after the cutover) ──
// Incremental counters, upserted in the same transaction as the history
// insert so rollups and usageHistory never drift. One row per dimension the
// dashboard shows; every dimension carries (model, provider) sub-keys because
// the dashboard groups every dimension's rows per model+provider. lastUsed is
// maintained in-row — reads never need to overlay-scan usageHistory for it.
const UPSERT_ROLLUP_HOURLY = `
  INSERT INTO usageRollupHourly(dateKey, hour, dimension, dimKey, model, provider, requests, promptTokens, completionTokens, cachedTokens, reasoningTokens, cost, lastUsed)
  VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(dateKey, hour, dimension, dimKey, model) DO UPDATE SET
    requests = requests + 1,
    promptTokens = promptTokens + excluded.promptTokens,
    completionTokens = completionTokens + excluded.completionTokens,
    cachedTokens = cachedTokens + excluded.cachedTokens,
    reasoningTokens = reasoningTokens + excluded.reasoningTokens,
    cost = cost + excluded.cost,
    provider = excluded.provider,
    lastUsed = CASE WHEN excluded.lastUsed > usageRollupHourly.lastUsed THEN excluded.lastUsed ELSE usageRollupHourly.lastUsed END`;

const UPSERT_ROLLUP_DAILY = `
  INSERT INTO usageRollupDaily(dateKey, dimension, dimKey, model, provider, requests, promptTokens, completionTokens, cachedTokens, reasoningTokens, cost, lastUsed)
  VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(dateKey, dimension, dimKey, model) DO UPDATE SET
    requests = requests + 1,
    promptTokens = promptTokens + excluded.promptTokens,
    completionTokens = completionTokens + excluded.completionTokens,
    cachedTokens = cachedTokens + excluded.cachedTokens,
    reasoningTokens = reasoningTokens + excluded.reasoningTokens,
    cost = cost + excluded.cost,
    provider = excluded.provider,
    lastUsed = CASE WHEN excluded.lastUsed > usageRollupDaily.lastUsed THEN excluded.lastUsed ELSE usageRollupDaily.lastUsed END`;

function rollupDimsForEntry(entry) {
  const model = entry.model || "";
  const provider = entry.provider || "";
  const dims = [];
  if (entry.provider) dims.push(["provider", entry.provider, model, provider]);
  if (entry.model) dims.push(["model", `${model}|${provider}`, model, provider]);
  if (entry.meta?.requestedModel) dims.push(["combo", entry.meta.requestedModel, model, provider]);
  if (entry.connectionId) dims.push(["account", entry.connectionId, model, provider]);
  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  dims.push(["apiKey", apiKeyVal, model, provider]);
  dims.push(["endpoint", entry.endpoint || "Unknown", model, provider]);
  return dims;
}

function upsertUsageRollups(db, entry, vals, dateKey, hour) {
  for (const [dimension, dimKey, model, provider] of rollupDimsForEntry(entry)) {
    const params = (prefixCols) => [
      ...prefixCols, dimension, dimKey, model, provider,
      vals.promptTokens, vals.completionTokens, vals.cachedTokens, vals.reasoningTokens,
      vals.cost, entry.timestamp,
    ];
    db.run(UPSERT_ROLLUP_HOURLY, params([dateKey, hour]));
    db.run(UPSERT_ROLLUP_DAILY, params([dateKey]));
  }
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  // [PENDING] console line removed; lifecycle is visible via "▶" and "📊 done" lines
  scheduleStatsEvent("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    let inserted = false;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      const existing = db.get(
        `SELECT id, endpoint FROM usageHistory
         WHERE timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      );

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        return;
      }

      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(entry.meta || {}),
        ]
      );

      const dateKey = getLocalDateKey(entry.timestamp);

      // Incremental rollup upserts — same transaction, so rollups can never
      // drift from usageHistory (rebuild from history stays a valid reset).
      // These replaced the usageDaily JSON blob read-modify-write: no more
      // parse+restringify of a per-day blob on every request.
      upsertUsageRollups(db, entry, {
        promptTokens,
        completionTokens,
        cachedTokens: tokens.cached_tokens || tokens.cache_read_input_tokens || 0,
        reasoningTokens: tokens.reasoning_tokens || 0,
        cost: entry.cost || 0,
      }, dateKey, new Date(entry.timestamp).getHours());

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      scheduleStatsEvent("update", 250);
    }
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
  }));
}

// ── Rollup reads — the only aggregation source for stats/chart ────────────
// Rows are bounded by dimension cardinality, never by request count; every
// request lands in exactly one row per dimension, so totals are read off a
// single unconditional dimension ('endpoint') to count each request once.
function rollupRowsForPeriod(db, period) {
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  if (period === "today") {
    return db.all(`SELECT * FROM usageRollupHourly WHERE dateKey = ?`, [todayKey]);
  }
  if (period === "24h") {
    // rolling 24h window: all of today + yesterday's hours from the current hour on
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return db.all(
      `SELECT * FROM usageRollupHourly WHERE dateKey = ? OR (dateKey = ? AND hour >= ?)`,
      [todayKey, getLocalDateKey(yesterday), now.getHours()]
    );
  }
  const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
  const maxDays = periodDays[period] || null; // "all" → every retained daily row
  if (maxDays) {
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - maxDays + 1);
    return db.all(`SELECT * FROM usageRollupDaily WHERE dateKey >= ?`, [getLocalDateKey(cutoff)]);
  }
  return db.all(`SELECT * FROM usageRollupDaily`);
}

// Merge one rollup row into the stats object — shape-compatible with what the
// dashboard already renders, plus nested per-model maps under byProvider /
// byCombo (the per-model breakdown rows).
function mergeRollupRow(stats, r, ctx) {
  const bump = (entry) => {
    entry.requests += r.requests || 0;
    entry.promptTokens += r.promptTokens || 0;
    entry.completionTokens += r.completionTokens || 0;
    entry.cachedTokens += r.cachedTokens || 0;
    entry.cost += r.cost || 0;
    if (r.lastUsed && r.lastUsed > (entry.lastUsed || "")) entry.lastUsed = r.lastUsed;
  };
  const newEntry = () => ({ requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" });
  const providerDisplayName = ctx.providerNodeNameMap[r.provider] || r.provider;
  const nestedKey = r.provider ? `${r.model} (${r.provider})` : r.model;

  switch (r.dimension) {
    case "provider": {
      stats.byProvider[r.dimKey] ??= { ...newEntry(), provider: providerDisplayName, byModel: {} };
      const e = stats.byProvider[r.dimKey];
      bump(e);
      // Nested rows key by raw model — the provider is already the group.
      e.byModel[r.model] ??= { ...newEntry(), rawModel: r.model, provider: providerDisplayName };
      bump(e.byModel[r.model]);
      break;
    }
    case "model": {
      stats.byModel[nestedKey] ??= { ...newEntry(), rawModel: r.model, provider: providerDisplayName };
      bump(stats.byModel[nestedKey]);
      break;
    }
    case "combo": {
      stats.byCombo[r.dimKey] ??= { ...newEntry(), comboName: r.dimKey, models: ctx.comboModelsMap[r.dimKey] || null, byModel: {} };
      const e = stats.byCombo[r.dimKey];
      bump(e);
      e.byModel[nestedKey] ??= { ...newEntry(), rawModel: r.model, provider: providerDisplayName };
      bump(e.byModel[nestedKey]);
      break;
    }
    case "account": {
      const accountName = ctx.connectionMap[r.dimKey] || `Account ${r.dimKey.slice(0, 8)}...`;
      const accountKey = `${r.model} (${r.provider} - ${accountName})`;
      stats.byAccount[accountKey] ??= { ...newEntry(), rawModel: r.model, provider: providerDisplayName, connectionId: r.dimKey, accountName };
      bump(stats.byAccount[accountKey]);
      break;
    }
    case "apiKey": {
      const isLocal = r.dimKey === "local-no-key";
      const apiKeyMasked = isLocal ? null : maskApiKey(r.dimKey);
      const keyInfo = isLocal ? null : ctx.apiKeyMap[r.dimKey];
      const keyName = keyInfo?.name || (isLocal ? "Local (No API Key)" : r.dimKey.slice(0, 8) + "...");
      const apiKeyKey = apiKeyMasked || "local-no-key";
      const akKey = `${apiKeyKey}|${r.model}|${r.provider || "unknown"}`;
      stats.byApiKey[akKey] ??= { ...newEntry(), rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey };
      bump(stats.byApiKey[akKey]);
      break;
    }
    case "endpoint": {
      const epKey = `${r.dimKey}|${r.model}|${r.provider || "unknown"}`;
      stats.byEndpoint[epKey] ??= { ...newEntry(), endpoint: r.dimKey, rawModel: r.model, provider: providerDisplayName };
      bump(stats.byEndpoint[epKey]);
      break;
    }
  }
}

export async function getUsageStats(period = "all") {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }, { getCombos }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
    import("./combosRepo.js"),
  ]);

  // Combo name → member models, to enrich stats.byCombo entries
  const comboModelsMap = {};
  try {
    for (const c of await getCombos()) if (c?.name) comboModelsMap[c.name] = c.models || [];
  } catch {}

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {}, byCombo: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
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

  // last10Minutes — query 10min window
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  // Aggregate from pre-computed rollups. Totals come off the unconditional
  // 'endpoint' dimension (every request writes exactly one such row), so each
  // request is counted once regardless of missing provider/model fields.
  const ctx = { providerNodeNameMap, connectionMap, apiKeyMap, comboModelsMap };
  for (const r of rollupRowsForPeriod(db, period)) {
    if (r.dimension === "endpoint") {
      stats.totalPromptTokens += r.promptTokens || 0;
      stats.totalCompletionTokens += r.completionTokens || 0;
      stats.totalCachedTokens += r.cachedTokens || 0;
      stats.totalCost += r.cost || 0;
    }
    mergeRollupRow(stats, r, ctx);
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

export async function getChartData(period = "7d") {
  const db = await getAdapter();

  if (period === "today" || period === "24h") {
    // Hourly buckets from the hourly rollup ('endpoint' dimension counts each
    // request once). Buckets are hour-aligned local time — "today" anchors at
    // local midnight, "24h" at the last 24 hour-buckets ending with the
    // current hour.
    const bucketCount = 24;
    const bucketMs = 3600000;
    const now = new Date();
    const startTime = period === "today"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      : Math.floor(now.getTime() / bucketMs) * bucketMs - (bucketCount - 1) * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT dateKey, hour, SUM(promptTokens + completionTokens) tokens, SUM(cost) cost
       FROM usageRollupHourly
       WHERE dimension = 'endpoint' AND ${period === "today" ? "dateKey = ?" : "(dateKey = ? OR (dateKey = ? AND hour >= ?))"}
       GROUP BY dateKey, hour`,
      period === "today"
        ? [getLocalDateKey(now)]
        : [getLocalDateKey(now), getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)), now.getHours()]
    );
    for (const r of rows) {
      // "YYYY-MM-DDTHH:00:00" (no Z) parses as LOCAL time — same clock the
      // rollup keys were written with.
      const t = new Date(`${r.dateKey}T${String(r.hour).padStart(2, "0")}:00:00`).getTime();
      const idx = Math.round((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += r.tokens || 0;
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  // Daily buckets from the daily rollup
  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - bucketCount + 1);

  const rows = db.all(
    `SELECT dateKey, SUM(promptTokens + completionTokens) tokens, SUM(cost) cost
     FROM usageRollupDaily
     WHERE dimension = 'endpoint' AND dateKey >= ?
     GROUP BY dateKey`,
    [getLocalDateKey(cutoff)]
  );
  const dayMap = {};
  for (const r of rows) dayMap[r.dateKey] = r;

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (bucketCount - 1 - i));
    const dayData = dayMap[getLocalDateKey(d)];
    return {
      label: labelFn(d),
      tokens: dayData?.tokens || 0,
      cost: dayData?.cost || 0,
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}
