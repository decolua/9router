import type { JsonValue } from "open-sse/types/executor.js";
import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { createApiKeyUsageId, normalizeApiKeyUsageId } from "../helpers/apiKeyUsageId.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS: Record<string, number> = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

// ── Global singletons (survive Next.js hot-reload) ────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var _pendingRequests: { byModel: Record<string, number>; byAccount: Record<string, Record<string, number>> } | undefined;
  // eslint-disable-next-line no-var
  var _lastErrorProvider: { provider: string; ts: number } | undefined;
  // eslint-disable-next-line no-var
  var _statsEmitter: EventEmitter | undefined;
  // eslint-disable-next-line no-var
  var _pendingTimers: Record<string, ReturnType<typeof setTimeout>> | undefined;
  // eslint-disable-next-line no-var
  var _recentRing: { items: RingEntry[]; initialized: boolean } | undefined;
  // eslint-disable-next-line no-var
  var _connectionMapCache: { map: Record<string, string>; ts: number } | undefined;
}

interface RingEntry {
  timestamp: string;
  provider: string | null;
  model: string | null;
  connectionId: string | null;
  apiKey: string | null;
  endpoint: string | null;
  cost: number | null;
  status: string | null;
  tokens: Record<string, number>;
}

interface CounterBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cost: number;
  rawModel?: string;
  provider?: string;
  apiKey?: string | null;
  endpoint?: string;
  connectionId?: string;
  accountName?: string;
  keyName?: string;
  apiKeyKey?: string;
  lastUsed?: string;
}
// StatsBucket = CounterBucket (same shape; alias kept for readability at call sites)
type StatsBucket = CounterBucket;

interface DayData {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cost: number;
  byProvider: Record<string, CounterBucket>;
  byModel: Record<string, CounterBucket>;
  byAccount: Record<string, CounterBucket>;
  byApiKey: Record<string, CounterBucket>;
  byEndpoint: Record<string, CounterBucket>;
}

if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };

const pendingRequests = global._pendingRequests!;
const lastErrorProvider = global._lastErrorProvider!;
const pendingTimers = global._pendingTimers!;
const recentRing = global._recentRing!;
const connCache = global._connectionMapCache!;

export const statsEmitter = global._statsEmitter!;

// dynamic import for circular-dep avoidance (connectionsRepo -> ... -> usageRepo); resolves through the .js shim
async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map: Record<string, string> = {};
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
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]) as Array<{ timestamp: string; provider: string | null; model: string | null; connectionId: string | null; apiKey: string | null; endpoint: string | null; cost: number; status: string | null; tokens: string | null }>;
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: normalizeApiKeyUsageId(r.apiKey), endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}) as Record<string, number>,
    }));
  } catch {}
}

interface PricingEntry { input: number; output: number; cached?: number; reasoning?: number; cache_creation?: number }

// dynamic import for circular-dep avoidance (pricingRepo -> ... -> usageRepo); resolves through the .js shim
async function calculateCost(provider: string | null | undefined, model: string | null | undefined, tokens: Record<string, number> | null | undefined) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model) as PricingEntry | null | undefined;
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens ?? tokens.input_tokens ?? 0;
    const cachedTokens = tokens.cached_tokens ?? tokens.cache_read_input_tokens ?? 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    cost += nonCachedInput * (pricing.input / 1000000);

    if (cachedTokens > 0) {
      const cachedRate = pricing.cached ?? pricing.input;
      cost += cachedTokens * (cachedRate / 1000000);
    }

    const outputTokens = tokens.completion_tokens ?? tokens.output_tokens ?? 0;
    cost += outputTokens * (pricing.output / 1000000);

    const reasoningTokens = tokens.reasoning_tokens ?? 0;
    if (reasoningTokens > 0) {
      const rate = pricing.reasoning ?? pricing.output;
      cost += reasoningTokens * (rate / 1000000);
    }

    const cacheCreationTokens = tokens.cache_creation_input_tokens ?? 0;
    if (cacheCreationTokens > 0) {
      const rate = pricing.cache_creation ?? pricing.input;
      cost += cacheCreationTokens * (rate / 1000000);
    }

    return cost;
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}
// ── Private helpers ───────────────────────────────────────────────────────────

function getApiKeyDisplayName(apiKeyId: string | null | undefined, apiKeyMap: Record<string, { name?: string }> = {}) {
  if (!apiKeyId) return "Local (No API Key)";
  const keyInfo = apiKeyMap[apiKeyId];
  if (keyInfo?.name) return keyInfo.name;
  if (apiKeyId.startsWith("sha256:")) return `API Key ${apiKeyId.slice(7, 15)}`;
  return "API Key";
}

function getLocalDateKey(timestamp: string | number | null | undefined) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(
  target: Record<string, CounterBucket>,
  key: string,
  values: { promptTokens?: number; completionTokens?: number; cacheReadTokens?: number; cost?: number; requests?: number; meta?: Partial<CounterBucket> },
) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0 };
  target[key].requests += values.requests ?? 1;
  target[key].promptTokens += values.promptTokens ?? 0;
  target[key].completionTokens += values.completionTokens ?? 0;
  target[key].cacheReadTokens += values.cacheReadTokens ?? 0;
  target[key].cost += values.cost ?? 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function trackPendingRequest(model: string, provider: string | null | undefined, connectionId: string | null | undefined, started: boolean, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, (pendingRequests.byModel[modelKey] ?? 0) + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    const acct = pendingRequests.byAccount[connectionId]!;
    if (!acct[modelKey]) acct[modelKey] = 0;
    acct[modelKey] = Math.max(0, (acct[modelKey] ?? 0) + (started ? 1 : -1));
    if (acct[modelKey] === 0) {
      delete acct[modelKey];
      if (Object.keys(acct).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if ((pendingRequests.byModel[modelKey] ?? 0) > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && (pendingRequests.byAccount[connectionId]?.[modelKey] ?? 0) > 0) {
        pendingRequests.byAccount[connectionId]![modelKey] = 0;
      }
      statsEmitter.emit("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  const t = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`);
  statsEmitter.emit("pending");
}

export async function getActiveRequests() {
  const activeRequests: Array<{ model: string; provider: string; account: string; count: number }> = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] ?? `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? (match[1] ?? modelKey) : modelKey,
          provider: match ? (match[2] ?? "unknown") : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set<string>();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((e) => {
      const t = e.tokens ?? {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider ?? "",
        promptTokens: t.prompt_tokens ?? t.input_tokens ?? 0,
        completionTokens: t.completion_tokens ?? t.output_tokens ?? 0,
        status: e.status ?? "ok",
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

function aggregateEntryToDay(day: DayData, entry: { provider?: string | null; model?: string | null; connectionId?: string | null; apiKey?: string | null; endpoint?: string | null; cost?: number; tokens?: Record<string, number> }) {
  const promptTokens = entry.tokens?.prompt_tokens ?? entry.tokens?.input_tokens ?? 0;
  const completionTokens = entry.tokens?.completion_tokens ?? entry.tokens?.output_tokens ?? 0;
  const cacheReadTokens = entry.tokens?.cache_read_input_tokens ?? entry.tokens?.cached_tokens ?? 0;
  const cost = entry.cost ?? 0;
  const vals = { promptTokens, completionTokens, cacheReadTokens, cost };

  day.requests = (day.requests ?? 0) + 1;
  day.promptTokens = (day.promptTokens ?? 0) + promptTokens;
  day.completionTokens = (day.completionTokens ?? 0) + completionTokens;
  day.cacheReadTokens = (day.cacheReadTokens ?? 0) + cacheReadTokens;
  day.cost = (day.cost ?? 0) + cost;

  day.byProvider ??= {};
  day.byModel ??= {};
  day.byAccount ??= {};
  day.byApiKey ??= {};
  day.byEndpoint ??= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : (entry.model ?? "");
  addToCounter(day.byModel, modelKey, { ...vals, meta: { ...(entry.model != null && { rawModel: entry.model }), ...(entry.provider != null && { provider: entry.provider }) } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { ...(entry.model != null && { rawModel: entry.model }), ...(entry.provider != null && { provider: entry.provider }) } });
  }

  const apiKeyVal = normalizeApiKeyUsageId(entry.apiKey) ?? "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model ?? ""}|${entry.provider ?? "unknown"}`;
  const akApiKey = normalizeApiKeyUsageId(entry.apiKey);
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { ...(entry.model != null && { rawModel: entry.model }), ...(entry.provider != null && { provider: entry.provider }), ...(akApiKey !== undefined && { apiKey: akApiKey }) } });

  const endpoint = entry.endpoint ?? "Unknown";
  const epKey = `${endpoint}|${entry.model ?? ""}|${entry.provider ?? "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, ...(entry.model != null && { rawModel: entry.model }), ...(entry.provider != null && { provider: entry.provider }) } });
}

function pushToRing(entry: RingEntry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

function loadDaysInRange(adapter: Awaited<ReturnType<typeof getAdapter>>, maxDays: number | null | undefined) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`) as Array<{ dateKey: string; data: string }>;
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]) as Array<{ dateKey: string; data: string }>;
}

export async function saveRequestUsage(entry: { timestamp?: string; provider?: string | null; model?: string | null; connectionId?: string | null; apiKey?: string | null; endpoint?: string | null; cost?: number; status?: string | null; tokens?: Record<string, number> }) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens ?? {};
    const promptTokens = tokens.prompt_tokens ?? tokens.input_tokens ?? 0;
    const completionTokens = tokens.completion_tokens ?? tokens.output_tokens ?? 0;
    const storedApiKey = normalizeApiKeyUsageId(entry.apiKey);
    const usageEntry = { ...entry, apiKey: storedApiKey };

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider ?? null, entry.model ?? null,
          entry.connectionId ?? null, storedApiKey, entry.endpoint ?? null,
          promptTokens, completionTokens, entry.cost ?? 0, entry.status ?? "ok",
          stringifyJson(tokens), stringifyJson({}),
        ]
      );

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]) as { data: string } | undefined;
      const day: DayData = row ? parseJson(row.data, {}) as DayData : {
        requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, usageEntry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day as unknown as JsonValue)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`) as { value: string } | undefined;
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
    });

    pushToRing(usageEntry as RingEntry);
    statsEmitter.emit("update");
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter: { provider?: string; model?: string; startDate?: string | Date; endDate?: string | Date } = {}) {
  const db = await getAdapter();
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params) as Array<{ timestamp: string; provider: string | null; model: string | null; connectionId: string | null; apiKey: string | null; endpoint: string | null; cost: number; status: string | null; tokens: string | null }>;

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKey: normalizeApiKeyUsageId(r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}) as Record<string, number>,
  }));
}

export async function getUsageStats(period = "all") {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    // dynamic import: circular-dep avoidance (connectionsRepo -> ... -> usageRepo); resolves through the .js shim
    import("./connectionsRepo.js"),
    // dynamic import: circular-dep avoidance (apiKeysRepo -> ... -> usageRepo); resolves through the .js shim
    import("./apiKeysRepo.js"),
    // dynamic import: circular-dep avoidance (nodesRepo -> ... -> usageRepo); resolves through the .js shim
    import("./nodesRepo.js"),
  ]);

  let allConnections: Array<{ id: string; name?: string; email?: string }> = [];
  try { allConnections = (await getProviderConnections()) as typeof allConnections; } catch {}
  const connectionMap: Record<string, string> = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap: Record<string, string> = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name as string;
  } catch {}

  let allApiKeys: Array<{ key: string; name?: string; id: string; createdAt?: string }> = [];
  try { allApiKeys = (await getApiKeys()) as typeof allApiKeys; } catch {}
  const apiKeyMap: Record<string, { name?: string; id: string; createdAt?: string }> = {};
  for (const k of allApiKeys) {
    const apiKeyId = createApiKeyUsageId(k.key);
    if (apiKeyId) apiKeyMap[apiKeyId] = { id: k.id, ...(k.name != null && { name: k.name }), ...(k.createdAt != null && { createdAt: k.createdAt }) };
  }

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`) as Array<{ timestamp: string; provider: string | null; model: string | null; tokens: string | null; status: string | null }>;
  const seenRecent = new Set<string>();
  const recentRequests = recentRows
    .map((r) => {
      const t = (parseJson(r.tokens, {}) as Record<string, number>) ?? {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider ?? "",
        promptTokens: t.prompt_tokens ?? t.input_tokens ?? 0,
        completionTokens: t.completion_tokens ?? t.output_tokens ?? 0,
        status: r.status ?? "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seenRecent.has(key)) return false;
      seenRecent.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCacheReadTokens: 0, totalCost: 0,
    cacheHitRatio: 0,
    byProvider: {} as Record<string, CounterBucket>,
    byModel: {} as Record<string, CounterBucket>,
    byAccount: {} as Record<string, CounterBucket>,
    byApiKey: {} as Record<string, CounterBucket>,
    byEndpoint: {} as Record<string, CounterBucket>,
    last10Minutes: [] as Array<{ requests: number; promptTokens: number; completionTokens: number; cost: number }>,
    pending: pendingRequests,
    activeRequests: [] as Array<{ model: string; provider: string; account: string; count: number }>,
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] ?? `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? (match[1] ?? modelKey) : modelKey,
          provider: match ? (match[2] ?? "unknown") : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — query 10-min window
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap: Record<number, { requests: number; promptTokens: number; completionTokens: number; cost: number }> = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  ) as Array<{ timestamp: string; promptTokens: number; completionTokens: number; cost: number }>;
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens ?? 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens ?? 0;
      bucketMap[minuteStart].cost += r.cost ?? 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const periodDays: Record<string, number> = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] ?? null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {}) as DayData;
      stats.totalPromptTokens += day.promptTokens ?? 0;
      stats.totalCompletionTokens += day.completionTokens ?? 0;
      stats.totalCacheReadTokens += day.cacheReadTokens ?? 0;
      stats.totalCost += day.cost ?? 0;

      for (const [prov, p] of Object.entries(day.byProvider ?? {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests ?? 0;
        stats.byProvider[prov].promptTokens += p.promptTokens ?? 0;
        stats.byProvider[prov].completionTokens += p.completionTokens ?? 0;
        stats.byProvider[prov].cacheReadTokens += p.cacheReadTokens ?? 0;
        stats.byProvider[prov].cost += p.cost ?? 0;
      }

      for (const [mk, m] of Object.entries(day.byModel ?? {})) {
        const rawModel = m.rawModel ?? (mk.split("|")[0] ?? "");
        const provider = m.provider ?? (mk.split("|")[1] ?? "");
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] ?? provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        const modelBucket = stats.byModel[statsKey]!;
        modelBucket.requests += m.requests ?? 0;
        modelBucket.promptTokens += m.promptTokens ?? 0;
        modelBucket.completionTokens += m.completionTokens ?? 0;
        modelBucket.cacheReadTokens += m.cacheReadTokens ?? 0;
        modelBucket.cost += m.cost ?? 0;
        if (dateKey > (modelBucket.lastUsed ?? "")) modelBucket.lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount ?? {})) {
        const accountName = connectionMap[connId] ?? `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel ?? "";
        const provider = a.provider ?? "";
        const providerDisplayName = providerNodeNameMap[provider] ?? provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests ?? 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens ?? 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens ?? 0;
        stats.byAccount[accountKey].cacheReadTokens += a.cacheReadTokens ?? 0;
        stats.byAccount[accountKey].cost += a.cost ?? 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed ?? "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [, ak] of Object.entries(day.byApiKey ?? {})) {
        const rawModel = ak.rawModel ?? "";
        const provider = ak.provider ?? "";
        const providerDisplayName = providerNodeNameMap[provider] ?? provider;
        const apiKeyVal = normalizeApiKeyUsageId(ak.apiKey ?? null);
        const keyName = getApiKeyDisplayName(apiKeyVal, apiKeyMap);
        const apiKeyKey = apiKeyVal ?? "local-no-key";
        const normalizedAkKey = `${apiKeyKey}|${rawModel}|${provider || "unknown"}`;
        if (!stats.byApiKey[normalizedAkKey]) {
          stats.byApiKey[normalizedAkKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKey: apiKeyVal, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[normalizedAkKey].requests += ak.requests ?? 0;
        stats.byApiKey[normalizedAkKey].promptTokens += ak.promptTokens ?? 0;
        stats.byApiKey[normalizedAkKey].completionTokens += ak.completionTokens ?? 0;
        stats.byApiKey[normalizedAkKey].cacheReadTokens += ak.cacheReadTokens ?? 0;
        stats.byApiKey[normalizedAkKey].cost += ak.cost ?? 0;
        if (dateKey > (stats.byApiKey[normalizedAkKey].lastUsed ?? "")) stats.byApiKey[normalizedAkKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint ?? {})) {
        const endpoint = ep.endpoint ?? epKey.split("|")[0] ?? "Unknown";
        const rawModel = ep.rawModel ?? "";
        const provider = ep.provider ?? "";
        const providerDisplayName = providerNodeNameMap[provider] ?? provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests ?? 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens ?? 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens ?? 0;
        stats.byEndpoint[epKey].cacheReadTokens += ep.cacheReadTokens ?? 0;
        stats.byEndpoint[epKey].cost += ep.cost ?? 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed ?? "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Overlay precise lastUsed timestamps from history
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
      [new Date(overlayCutoff).toISOString()]
    ) as Array<{ timestamp: string; provider: string | null; model: string | null; connectionId: string | null; apiKey: string | null; endpoint: string | null }>;
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : (e.model ?? "");
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed ?? "")) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] ?? `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed ?? "")) stats.byAccount[accountKey].lastUsed = ts;
      }

      const historyApiKeyId = normalizeApiKeyUsageId(e.apiKey);
      const apiKeyKey = historyApiKeyId
        ? `${historyApiKeyId}|${e.model}|${e.provider ?? "unknown"}`
        : `local-no-key|${e.model}|${e.provider ?? "unknown"}`;
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed ?? "")) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint ?? "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider ?? "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed ?? "")) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {
    // 24h / today: live history
    let cutoff: string;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - (PERIOD_MS["24h"] ?? 86400000)).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    ) as Array<{ timestamp: string; provider: string | null; model: string | null; connectionId: string | null; apiKey: string | null; endpoint: string | null; promptTokens: number; completionTokens: number; cost: number; tokens: string | null }>;

    for (const r of filtered) {
      const tokens = (parseJson(r.tokens, {}) as Record<string, number>) ?? {};
      const promptTokens = tokens.prompt_tokens ?? tokens.input_tokens ?? r.promptTokens ?? 0;
      const completionTokens = tokens.completion_tokens ?? tokens.output_tokens ?? r.completionTokens ?? 0;
      const cacheReadTokens = tokens.cache_read_input_tokens ?? tokens.cached_tokens ?? 0;
      const entryCost = r.cost ?? 0;
      const providerDisplayName = providerNodeNameMap[r.provider ?? ""] ?? r.provider ?? "";

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCacheReadTokens += cacheReadTokens;
      stats.totalCost += entryCost;

      const prov = r.provider ?? "unknown";
      if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0 };
      stats.byProvider[prov].requests++;
      stats.byProvider[prov].promptTokens += promptTokens;
      stats.byProvider[prov].completionTokens += completionTokens;
      stats.byProvider[prov].cacheReadTokens += cacheReadTokens;
      stats.byProvider[prov].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : (r.model ?? "");
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel: r.model ?? "", provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cacheReadTokens += cacheReadTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed ?? "")) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] ?? `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel: r.model ?? "", provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cacheReadTokens += cacheReadTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed ?? "")) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      const apiKeyId = normalizeApiKeyUsageId(r.apiKey);
      if (apiKeyId) {
        const keyName = getApiKeyDisplayName(apiKeyId, apiKeyMap);
        const akKey = `${apiKeyId}|${r.model}|${r.provider ?? "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel: r.model ?? "", provider: providerDisplayName, apiKey: apiKeyId, keyName, apiKeyKey: apiKeyId, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cacheReadTokens += cacheReadTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed ?? "")) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, rawModel: r.model ?? "", provider: providerDisplayName, apiKey: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cacheReadTokens += cacheReadTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed ?? "")) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint ?? "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider ?? "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, endpoint, rawModel: r.model ?? "", provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cacheReadTokens += cacheReadTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed ?? "")) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests ?? 0), 0);
  stats.cacheHitRatio = stats.totalPromptTokens > 0 ? stats.totalCacheReadTokens / stats.totalPromptTokens : 0;
  return stats;
}

export async function getChartData(period = "7d") {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0, promptTokens: 0, cacheHitRatio: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    ) as Array<{ timestamp: string; promptTokens: number; completionTokens: number; cost: number; tokens: string | null }>;
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        const b = buckets[idx]!;
        b.tokens += (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
        b.promptTokens += (r.promptTokens ?? 0);
        const parsedTokens = (parseJson(r.tokens, {}) as Record<string, number>) ?? {};
        b.cachedTokens += parsedTokens.cache_read_input_tokens ?? parsedTokens.cached_tokens ?? 0;
        b.cost += r.cost ?? 0;
      }
    }
    for (const b of buckets) {
      b.cacheHitRatio = b.promptTokens > 0 ? b.cachedTokens / b.promptTokens : 0;
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0, promptTokens: 0, cacheHitRatio: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    ) as Array<{ timestamp: string; promptTokens: number; completionTokens: number; cost: number; tokens: string | null }>;
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      const b = buckets[idx]!;
      b.tokens += (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
      b.promptTokens += (r.promptTokens ?? 0);
      const parsedTokens = (parseJson(r.tokens, {}) as Record<string, number>) ?? {};
      b.cachedTokens += parsedTokens.cache_read_input_tokens ?? parsedTokens.cached_tokens ?? 0;
      b.cost += r.cost ?? 0;
    }
    for (const b of buckets) {
      b.cacheHitRatio = b.promptTokens > 0 ? b.cachedTokens / b.promptTokens : 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data
  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap: Record<string, DayData> = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {}) as DayData;

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    const promptTokens = dayData ? (dayData.promptTokens ?? 0) : 0;
    const cachedTokens = dayData ? (dayData.cacheReadTokens ?? 0) : 0;
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens ?? 0) + (dayData.completionTokens ?? 0) : 0,
      cachedTokens,
      promptTokens,
      cacheHitRatio: promptTokens > 0 ? cachedTokens / promptTokens : 0,
      cost: dayData ? (dayData.cost ?? 0) : 0,
    };
  });
}
// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

function formatLogDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    ) as Array<{ timestamp: string; provider: string | null; model: string | null; connectionId: string | null; promptTokens: number | null; completionTokens: number | null; status: string | null; tokens: string | null }>;
    if (!rows.length) return [];

    const connMap: Record<string, string> = {};
    try {
      // dynamic import for circular-dep avoidance (connectionsRepo -> ... -> usageRepo); resolves through the .js shim
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() ?? "-";
      const m = r.model ?? "-";
      const account = connMap[r.connectionId ?? ""] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? (parseJson(r.tokens, {}) as Record<string, number>) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status ?? "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", (e as Error).message);
    return [];
  }
}

// ── Per-key monthly usage (calendar month, server local time) ────────────────
// Usage rows store createApiKeyUsageId(rawKey) (sha256-prefix), NOT the raw key.
// These queries mirror that storage so callers pass the raw key.

function startOfCurrentMonthLocalISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export async function getMonthlyUsageForKey(rawKey: string | null | undefined) {
  if (!rawKey) return { tokens: 0, cost: 0, requests: 0, monthStart: startOfCurrentMonthLocalISO() };
  const db = await getAdapter();
  const usageId = createApiKeyUsageId(rawKey);
  const start = startOfCurrentMonthLocalISO();
  const row = db.get(
    `SELECT COALESCE(SUM(promptTokens + completionTokens), 0) as tokens,
            COALESCE(SUM(cost), 0) as cost,
            COUNT(*) as requests
       FROM usageHistory
      WHERE apiKey = ? AND timestamp >= ?`,
    [usageId, start]
  ) as { tokens: number; cost: number; requests: number } | undefined;
  return {
    tokens: row?.tokens ?? 0,
    cost: row?.cost ?? 0,
    requests: row?.requests ?? 0,
    monthStart: start,
  };
}

export async function getMonthlyUsageBreakdownForKey(rawKey: string | null | undefined) {
  if (!rawKey) return [];
  const db = await getAdapter();
  const usageId = createApiKeyUsageId(rawKey);
  const start = startOfCurrentMonthLocalISO();
  const rows = db.all(
    `SELECT model, provider,
            SUM(promptTokens + completionTokens) as tokens,
            SUM(cost) as cost,
            COUNT(*) as requests
       FROM usageHistory
      WHERE apiKey = ? AND timestamp >= ?
      GROUP BY model, provider
      ORDER BY tokens DESC`,
    [usageId, start]
  ) as Array<{ model: string | null; provider: string | null; tokens: number; cost: number; requests: number }>;
  return rows.map((r) => ({
    model: r.model,
    provider: r.provider,
    tokens: r.tokens ?? 0,
    cost: r.cost ?? 0,
    requests: r.requests ?? 0,
  }));
}