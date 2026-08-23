import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";
import { createModelMappingMap, getMappedModelName } from "@/shared/utils/modelMapping.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

function firstTokenCount(...values) {
  let fallback = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > 0) return parsed;
    fallback = parsed;
  }
  return fallback;
}

function getCacheTokenCounts(tokens = {}) {
  const promptDetails = tokens.prompt_tokens_details || {};
  const inputDetails = tokens.input_tokens_details || {};
  const nestedUsage = tokens.usage || {};

  return {
    cacheReadTokens: firstTokenCount(
      tokens.cached_tokens,
      tokens.cache_read_input_tokens,
      tokens.cache_read_tokens,
      tokens.prompt_cache_hit_tokens,
      tokens.cache_hit_tokens,
      promptDetails.cached_tokens,
      inputDetails.cached_tokens,
      nestedUsage.cached_tokens,
      nestedUsage.cache_read_input_tokens,
      nestedUsage.cache_read_tokens,
      nestedUsage.prompt_cache_hit_tokens,
      nestedUsage.cache_hit_tokens,
      nestedUsage.prompt_tokens_details?.cached_tokens,
      nestedUsage.input_tokens_details?.cached_tokens,
    ),
    cacheCreationTokens: firstTokenCount(
      tokens.cache_creation_input_tokens,
      tokens.cache_creation_tokens,
      tokens.cache_write_input_tokens,
      tokens.cache_write_tokens,
      tokens.prompt_cache_miss_tokens,
      tokens.cache_miss_tokens,
      promptDetails.cache_creation_tokens,
      promptDetails.cache_creation_input_tokens,
      inputDetails.cache_creation_tokens,
      inputDetails.cache_creation_input_tokens,
      nestedUsage.cache_creation_input_tokens,
      nestedUsage.cache_creation_tokens,
      nestedUsage.cache_write_input_tokens,
      nestedUsage.cache_write_tokens,
      nestedUsage.prompt_cache_miss_tokens,
      nestedUsage.cache_miss_tokens,
      nestedUsage.prompt_tokens_details?.cache_creation_tokens,
      nestedUsage.input_tokens_details?.cache_creation_tokens,
    ),
  };
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

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

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
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

async function calculateCost(provider, model, tokens, timestamp) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing, timestamp);
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
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens, entry.timestamp);

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
        if ((!existing.endpoint && entry.endpoint) || entry.meta) {
          db.run(`UPDATE usageHistory SET endpoint = COALESCE(endpoint, ?), meta = ? WHERE id = ?`, [entry.endpoint || null, stringifyJson(entry.meta || {}), existing.id]);
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
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

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

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

export async function getUsageStats(period = "all", range = {}) {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }, { getSettings }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
    import("./settingsRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const settings = await getSettings();
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
    Object.assign(providerNodeNameMap, settings.providerDisplayNames || {});
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
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
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

  const useDailySummary = !["24h", "today", "custom"].includes(period);

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = ak.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyMasked = maskApiKey(apiKeyVal);
        const apiKeyKey = apiKeyMasked || "local-no-key";
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[akKey].requests += ak.requests || 0;
        stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[akKey].cost += ak.cost || 0;
        if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Overlay precise lastUsed timestamps from history
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
      [new Date(overlayCutoff).toISOString()]
    );
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
      }

      const apiKeyKey = (e.apiKey && typeof e.apiKey === "string")
        ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "custom") {
      cutoff = range.startDate ? new Date(range.startDate).toISOString() : new Date(0).toISOString();
    } else if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const customEnd = period === "custom" && range.endDate ? new Date(range.endDate).toISOString() : new Date().toISOString();
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
      [cutoff, customEnd]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests++;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.apiKey && typeof r.apiKey === "string") {
        const keyInfo = apiKeyMap[r.apiKey];
        const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
        const apiKeyMasked = maskApiKey(r.apiKey);
        const akKey = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: apiKeyMasked, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  // API-key analysis needs exact per-rate components. Rebuild it from history for
  // every period so legacy daily summaries also gain cache-write and component costs.
  let apiKeyStart = new Date(0);
  let apiKeyEnd = new Date();
  if (period === "custom") {
    apiKeyStart = range.startDate ? new Date(range.startDate) : apiKeyStart;
    apiKeyEnd = range.endDate ? new Date(range.endDate) : apiKeyEnd;
  } else if (period === "today") {
    apiKeyStart = new Date();
    apiKeyStart.setHours(0, 0, 0, 0);
  } else if (period === "24h") {
    apiKeyStart = new Date(Date.now() - PERIOD_MS["24h"]);
  } else if (["7d", "30d", "60d"].includes(period)) {
    const days = { "7d": 7, "30d": 30, "60d": 60 }[period];
    apiKeyStart = new Date();
    apiKeyStart.setHours(0, 0, 0, 0);
    apiKeyStart.setDate(apiKeyStart.getDate() - days + 1);
  }

  const apiKeyRows = db.all(
    `SELECT timestamp, provider, model, apiKey, promptTokens, completionTokens, tokens
     FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [apiKeyStart.toISOString(), apiKeyEnd.toISOString()],
  );
  const [{ getPricingForModel }, { calculateCostBreakdown }] = await Promise.all([
    import("./pricingRepo.js"),
    import("open-sse/providers/pricing.js"),
  ]);
  const pricingCache = new Map();
  const pricedRows = await Promise.all(apiKeyRows.map(async (row) => {
    const tokens = parseJson(row.tokens, {}) || {};
    const { cacheReadTokens, cacheCreationTokens } = getCacheTokenCounts(tokens);
    const normalizedTokens = {
      ...tokens,
      prompt_tokens: Number(row.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0),
      completion_tokens: Number(row.completionTokens ?? tokens.completion_tokens ?? tokens.output_tokens ?? 0),
      cached_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
    };
    const pricingKey = `${row.provider || ""}|${row.model || ""}`;
    if (!pricingCache.has(pricingKey)) pricingCache.set(pricingKey, getPricingForModel(row.provider, row.model));
    const pricing = await pricingCache.get(pricingKey);
    const breakdown = pricing
      ? calculateCostBreakdown(normalizedTokens, pricing, row.timestamp)
      : await calculateBreakdown(row.provider, row.model, normalizedTokens, row.timestamp);
    return { row, breakdown };
  }));

  stats.byApiKey = {};
  stats.byProvider = {};
  stats.byModel = {};
  const { getModelMappings } = await import("./aliasRepo.js");
  const modelMappingMap = createModelMappingMap(await getModelMappings());
  for (const { row, breakdown } of pricedRows) {
    const apiKeyValue = row.apiKey && typeof row.apiKey === "string" ? row.apiKey : null;
    const keyInfo = apiKeyValue ? apiKeyMap[apiKeyValue] : null;
    const apiKeyMasked = maskApiKey(apiKeyValue);
    const keyName = keyInfo?.name || (apiKeyValue ? `${apiKeyValue.slice(0, 8)}...` : "本地调用（无 API 密钥）");
    const providerDisplayName = providerNodeNameMap[row.provider] || row.provider || "未知提供商";
    const providerKey = row.provider || "unknown";
    const mappedModel = getMappedModelName(modelMappingMap, row.provider, row.model || "未知模型");
    if (!stats.byProvider[providerKey]) {
      stats.byProvider[providerKey] = {
        provider: providerDisplayName,
        requests: 0, promptTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, completionTokens: 0,
        inputCost: 0, cachedCost: 0, cacheCreationCost: 0, outputCost: 0, cost: 0, lastUsed: row.timestamp,
      };
    }
    const providerTarget = stats.byProvider[providerKey];
    providerTarget.requests += 1;
    providerTarget.promptTokens += breakdown.inputTokens;
    providerTarget.cachedTokens += breakdown.cacheReadTokens;
    providerTarget.cacheCreationTokens += breakdown.cacheCreationTokens;
    providerTarget.completionTokens += breakdown.outputTokens;
    providerTarget.inputCost += breakdown.inputCost;
    providerTarget.cachedCost += breakdown.cacheReadCost;
    providerTarget.cacheCreationCost += breakdown.cacheCreationCost;
    providerTarget.outputCost += breakdown.outputCost;
    providerTarget.cost += breakdown.totalCost;
    if (new Date(row.timestamp) > new Date(providerTarget.lastUsed)) providerTarget.lastUsed = row.timestamp;

    const modelKey = `${mappedModel}|${providerKey}`;
    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = {
        rawModel: mappedModel, provider: providerDisplayName,
        requests: 0, promptTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, completionTokens: 0,
        inputCost: 0, cachedCost: 0, cacheCreationCost: 0, outputCost: 0, cost: 0, lastUsed: row.timestamp,
      };
    }
    const modelTarget = stats.byModel[modelKey];
    modelTarget.requests += 1;
    modelTarget.promptTokens += breakdown.inputTokens;
    modelTarget.cachedTokens += breakdown.cacheReadTokens;
    modelTarget.cacheCreationTokens += breakdown.cacheCreationTokens;
    modelTarget.completionTokens += breakdown.outputTokens;
    modelTarget.inputCost += breakdown.inputCost;
    modelTarget.cachedCost += breakdown.cacheReadCost;
    modelTarget.cacheCreationCost += breakdown.cacheCreationCost;
    modelTarget.outputCost += breakdown.outputCost;
    modelTarget.cost += breakdown.totalCost;
    if (new Date(row.timestamp) > new Date(modelTarget.lastUsed)) modelTarget.lastUsed = row.timestamp;

    const statsKey = `${apiKeyMasked || "local-no-key"}|${mappedModel}|${row.provider || "unknown"}`;
    if (!stats.byApiKey[statsKey]) {
      stats.byApiKey[statsKey] = {
        requests: 0,
        promptTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        completionTokens: 0,
        inputCost: 0,
        cachedCost: 0,
        cacheCreationCost: 0,
        outputCost: 0,
        cost: 0,
        rawModel: mappedModel,
        provider: providerDisplayName,
        apiKeyMasked,
        keyName,
        apiKeyKey: apiKeyMasked || "local-no-key",
        lastUsed: row.timestamp,
      };
    }
    const target = stats.byApiKey[statsKey];
    target.requests += 1;
    target.promptTokens += breakdown.inputTokens;
    target.cachedTokens += breakdown.cacheReadTokens;
    target.cacheCreationTokens += breakdown.cacheCreationTokens;
    target.completionTokens += breakdown.outputTokens;
    target.inputCost += breakdown.inputCost;
    target.cachedCost += breakdown.cacheReadCost;
    target.cacheCreationCost += breakdown.cacheCreationCost;
    target.outputCost += breakdown.outputCost;
    target.cost += breakdown.totalCost;
    if (new Date(row.timestamp) > new Date(target.lastUsed)) target.lastUsed = row.timestamp;
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

export async function getChartData(period = "7d", range = {}) {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  if (period === "custom" && range.startDate) {
    const startTime = new Date(range.startDate).getTime();
    const endTime = range.endDate ? new Date(range.endDate).getTime() : now;
    const span = Math.max(1, endTime - startTime);
    const bucketCount = Math.min(60, Math.max(1, Math.ceil(span / 86400000)));
    const bucketMs = span / bucketCount;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: new Date(startTime + i * bucketMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      tokens: 0,
      cost: 0,
    }));
    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
      [new Date(startTime).toISOString(), new Date(endTime).toISOString()]
    );
    for (const r of rows) {
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((new Date(r.timestamp).getTime() - startTime) / bucketMs)));
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data
  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Successful requests are persisted by saveRequestUsage. Lifecycle logging only
// needs to retain terminal failures so usageHistory remains duplicate-free.
export async function appendRequestLog(entry = {}) {
  const status = String(entry.status || "").trim();
  if (!/^(FAILED|ERROR)\b/i.test(status)) return;

  await saveRequestUsage({
    provider: entry.provider,
    model: entry.model,
    connectionId: entry.connectionId,
    apiKey: entry.apiKey,
    endpoint: entry.endpoint,
    status,
    tokens: entry.tokens || {},
    timestamp: entry.timestamp || new Date().toISOString(),
  });
}

function getDimensionRange(period, range = {}) {
  const now = new Date();
  let start;
  let end = new Date(now);
  let bucketMs;
  if (period === "today") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
    bucketMs = 60 * 60 * 1000;
  } else if (period === "24h") {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    bucketMs = 60 * 60 * 1000;
  } else if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    end = new Date(start);
    end.setDate(end.getDate() + days);
    bucketMs = 24 * 60 * 60 * 1000;
  } else {
    start = range.startDate ? new Date(range.startDate) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    end = range.endDate ? new Date(range.endDate) : now;
    bucketMs = end.getTime() - start.getTime() <= 48 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Invalid usage date range");
  }
  const durationMs = end.getTime() - start.getTime();
  const naturalBucketCount = Math.max(1, Math.ceil(durationMs / bucketMs));
  if (naturalBucketCount > 90) bucketMs = Math.ceil(durationMs / 90);
  return { start, end, bucketMs, bucketCount: Math.max(1, Math.ceil(durationMs / bucketMs)) };
}

export async function getDimensionChartData(period = "7d", range = {}, dimension = "apiKey", metric = "tokens") {
  const allowedDimensions = new Set(["apiKey", "provider", "model"]);
  const allowedMetrics = new Set(["tokens", "requests", "latency"]);
  if (!allowedDimensions.has(dimension) || !allowedMetrics.has(metric)) throw new Error("Invalid usage chart dimension");
  const db = await getAdapter();
  const { start, end, bucketMs, bucketCount } = getDimensionRange(period, range);
  const rows = db.all(
    `SELECT timestamp, provider, model, apiKey, promptTokens, completionTokens, tokens, meta
     FROM usageHistory WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC`,
    [start.toISOString(), end.toISOString()],
  );
  const { getApiKeys } = await import("./apiKeysRepo.js");
  const apiKeys = dimension === "apiKey" ? await getApiKeys() : [];
  const keyNames = new Map(apiKeys.map((key) => [key.key, key.name || key.id]));
  const { getModelMappings } = await import("./aliasRepo.js");
  const modelMappingMap = dimension === "model"
    ? createModelMappingMap(await getModelMappings())
    : new Map();
  const providerNames = new Map();
  if (dimension === "provider") {
    const [{ getProviderNodes }, { getSettings }] = await Promise.all([
      import("./nodesRepo.js"),
      import("./settingsRepo.js"),
    ]);
    const [nodes, settings] = await Promise.all([getProviderNodes(), getSettings()]);
    for (const node of nodes) if (node.id && node.name) providerNames.set(node.id, node.name);
    for (const [providerId, name] of Object.entries(settings.providerDisplayNames || {})) providerNames.set(providerId, name);
  }
  const buckets = Array.from({ length: bucketCount }, () => new Map());
  const totals = new Map();

  for (const row of rows) {
    const timestamp = new Date(row.timestamp).getTime();
    const index = Math.floor((timestamp - start.getTime()) / bucketMs);
    if (index < 0 || index >= bucketCount) continue;
    const group = dimension === "apiKey"
      ? (row.apiKey ? (keyNames.get(row.apiKey) || `${row.apiKey.slice(0, 8)}...`) : "本地调用（无 API 密钥）")
      : dimension === "provider" ? (providerNames.get(row.provider) || row.provider || "未知提供商") : getMappedModelName(modelMappingMap, row.provider, row.model || "未知模型");
    const tokens = parseJson(row.tokens, {}) || {};
    const latency = Number(parseJson(row.meta, {})?.latency?.total || 0);
    const value = metric === "requests" ? 1
      : metric === "latency" ? latency
      : Number(row.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0) + Number(row.completionTokens ?? tokens.completion_tokens ?? tokens.output_tokens ?? 0);
    if (metric === "latency" && value <= 0) continue;
    const current = buckets[index].get(group) || { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    buckets[index].set(group, current);
    const total = totals.get(group) || { sum: 0, count: 0 };
    total.sum += value;
    total.count += 1;
    totals.set(group, total);
  }

  const ranked = [...totals.entries()]
    .sort((a, b) => (metric === "latency" ? b[1].sum / b[1].count : b[1].sum) - (metric === "latency" ? a[1].sum / a[1].count : a[1].sum))
    .slice(0, 8);
  const series = ranked.map(([label], index) => ({ id: `series_${index}`, label }));
  const data = buckets.map((bucket, index) => {
    const timestamp = start.getTime() + index * bucketMs;
    const point = {
      label: bucketMs < 24 * 60 * 60 * 1000
        ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
        : new Date(timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
    };
    series.forEach((item) => {
      const value = bucket.get(item.label);
      point[item.id] = !value ? 0 : metric === "latency" ? Math.round(value.sum / value.count) : value.sum;
    });
    return point;
  });
  return { series, data, metric };
}

async function calculateBreakdown(provider, model, tokens, timestamp) {
  const { cacheReadTokens, cacheCreationTokens } = getCacheTokenCounts(tokens);
  const promptTokens = Math.max(0, Number(tokens?.prompt_tokens || tokens?.input_tokens || 0));
  const reasoningTokens = Math.max(0, Number(tokens?.reasoning_tokens || 0));
  const fallbackTokens = {
    inputTokens: Math.max(0, promptTokens - cacheReadTokens - cacheCreationTokens),
    cacheReadTokens,
    cacheCreationTokens,
    outputTokens: Math.max(0, Number(tokens?.completion_tokens || tokens?.output_tokens || 0)) + reasoningTokens,
    inputCost: 0,
    cacheReadCost: 0,
    cacheCreationCost: 0,
    outputCost: 0,
    totalCost: 0,
  };
  if (!tokens || !provider || !model) return fallbackTokens;
  try {
    const [{ getPricingForModel }, { calculateCostBreakdown }] = await Promise.all([
      import("./pricingRepo.js"),
      import("open-sse/providers/pricing.js"),
    ]);
    const pricing = await getPricingForModel(provider, model);
    return pricing ? calculateCostBreakdown(tokens, pricing, timestamp) : fallbackTokens;
  } catch (error) {
    console.error("Error calculating cost breakdown:", error);
    return fallbackTokens;
  }
}

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

export async function getUsageLogs(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.status === "success") {
    conds.push("LOWER(status) IN ('ok', 'success', '200 ok')");
  } else if (filter.status === "failed") {
    conds.push("(UPPER(status) LIKE 'FAILED%' OR UPPER(status) LIKE 'ERROR%')");
  } else if (filter.status) {
    conds.push("status = ?");
    params.push(filter.status);
  }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  if (filter.apiKey) {
    const { getApiKeys } = await import("./apiKeysRepo.js");
    const keys = await getApiKeys();
    const selected = keys.find((key) => key.id === filter.apiKey || key.name === filter.apiKey || key.key === filter.apiKey);
    if (selected) {
      conds.push("apiKey = ?");
      params.push(selected.key);
    } else {
      return { logs: [], pagination: { page: filter.page || 1, pageSize: filter.pageSize || 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
    }
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filter.pageSize) || 50));
  const totalItems = db.get(`SELECT COUNT(*) AS c FROM usageHistory ${where}`, params)?.c || 0;
  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta FROM usageHistory ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }, { getSettings }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
    import("./settingsRepo.js"),
  ]);
  const [connections, apiKeys, providerNodes, settings] = await Promise.all([
    getProviderConnections(), getApiKeys(), getProviderNodes(), getSettings(),
  ]);
  const connMap = Object.fromEntries(connections.map((c) => [c.id, c.name || c.email || c.id]));
  const keyMap = Object.fromEntries(apiKeys.map((k) => [k.key, k.name || k.id]));
  const providerNameMap = Object.fromEntries(providerNodes.filter((node) => node.id && node.name).map((node) => [node.id, node.name]));
  Object.assign(providerNameMap, settings.providerDisplayNames || {});
  const { getModelMappings } = await import("./aliasRepo.js");
  const modelMappingMap = createModelMappingMap(await getModelMappings());
  const mask = (key) => !key ? null : key.length <= 8 ? `${key[0]}***` : `${key.slice(0, 8)}***`;
  const logs = await Promise.all(rows.map(async (r) => {
    const tokens = parseJson(r.tokens, {}) || {};
    const { cacheReadTokens, cacheCreationTokens } = getCacheTokenCounts(tokens);
    const normalizedTokens = {
      ...tokens,
      prompt_tokens: Number(r.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0),
      completion_tokens: Number(r.completionTokens ?? tokens.completion_tokens ?? tokens.output_tokens ?? 0),
      cached_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
    };
    const breakdown = await calculateBreakdown(r.provider, r.model, normalizedTokens, r.timestamp);
    const meta = parseJson(r.meta, {}) || {};
    return {
      id: r.id,
      timestamp: r.timestamp,
      apiKey: mask(r.apiKey),
      apiKeyName: r.apiKey ? (keyMap[r.apiKey] || mask(r.apiKey)) : "Local (No API Key)",
      model: getMappedModelName(modelMappingMap, r.provider, r.model),
      providerId: r.provider,
      provider: providerNameMap[r.provider] || r.provider,
      endpoint: r.endpoint,
      account: r.connectionId ? (connMap[r.connectionId] || r.connectionId) : null,
      ...breakdown,
      cost: breakdown.totalCost || Number(r.cost || 0),
      status: r.status || "ok",
      latencyMs: Number(meta.latency?.total || meta.latencyMs || meta.durationMs || 0),
      logType: ["ok", "success", "200 ok"].includes(String(r.status || "").toLowerCase()) ? "success" : "failed",
    };
  }));
  const totalPages = Math.ceil(totalItems / pageSize);
  return { logs, pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
}
