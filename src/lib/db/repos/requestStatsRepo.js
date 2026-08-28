import { getAdapter } from "../driver.js";
import { canonicalizeUsage } from "open-sse/utils/usageTracking.js";

// Full-history statistics source. One row per request (id is the requestDetail
// id, shared across the streaming start/complete upsert), written
// unconditionally from saveRequestDetail — independent of the observability
// ring-buffer toggle. Retained statsRetentionDays (default 45), cleaned on a
// cadence from saveRequestStats.

const DEFAULT_RETENTION_DAYS = 45;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const MIN_MS = 60000;

// Candidate bucket widths, coarse→fine. Auto-granularity picks the coarsest
// width that still yields ≥ MIN_SERIES_POINTS buckets over the actual data span.
const SERIES_BUCKET_MS = [
  DAY_MS,
  12 * HOUR_MS,
  6 * HOUR_MS,
  3 * HOUR_MS,
  HOUR_MS,
  30 * MIN_MS,
  15 * MIN_MS,
  5 * MIN_MS,
  MIN_MS,
];
const MIN_SERIES_POINTS = 30;

let lastCleanup = 0;
let backfillStarted = false;

async function getConnectionMap() {
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    return map;
  } catch {
    return {};
  }
}

// The provider's display name comes from its provider node (the name the user
// configured for the node, e.g. "b-ai"), not the connection/account name
// (e.g. "2"). Standard registry providers have no node and keep their key.
async function getProviderNameMap() {
  try {
    const { getProviderNodes } = await import("./nodesRepo.js");
    const nodes = await getProviderNodes();
    const map = {};
    for (const n of nodes) {
      if (n.id && n.name && !map[n.id]) map[n.id] = n.name;
    }
    return map;
  } catch {
    return {};
  }
}

// Filter values may be a single value or an array (multi-select). Empty /
// falsy means "no filter on this dimension" (all). Arrays build an IN clause.
function colIn(col, values) {
  const list = (Array.isArray(values) ? values : values ? [values] : []).filter(Boolean);
  if (list.length === 0) return null;
  const placeholders = list.map(() => "?").join(", ");
  return { clause: `${col} IN (${placeholders})`, params: list };
}

export function buildStatsWhere(filter = {}) {
  const conds = [];
  const params = [];
  for (const [col, key] of [["provider", "provider"], ["model", "model"], ["connectionId", "connectionId"]]) {
    const c = colIn(col, filter[key]);
    if (c) { conds.push(c.clause); params.push(...c.params); }
  }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return { where, params };
}

export async function saveRequestStats(detail) {
  if (!detail || typeof detail !== "object" || !detail.id) return;
  try {
    const db = await getAdapter();
    const tokens = canonicalizeUsage(detail.tokens) || {};
    const latency = detail.latency || {};
    db.run(
      `INSERT INTO requestStats(id, timestamp, provider, model, connectionId, status,
         promptTokens, completionTokens, cachedTokens, cacheCreationTokens, reasoningTokens,
         latencyTotal, latencyTtft)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         timestamp = excluded.timestamp,
         status = excluded.status,
         promptTokens = excluded.promptTokens,
         completionTokens = excluded.completionTokens,
         cachedTokens = excluded.cachedTokens,
         cacheCreationTokens = excluded.cacheCreationTokens,
         reasoningTokens = excluded.reasoningTokens,
         latencyTotal = excluded.latencyTotal,
         latencyTtft = excluded.latencyTtft`,
      [
        detail.id,
        detail.timestamp || new Date().toISOString(),
        detail.provider || null,
        detail.model || null,
        detail.connectionId || null,
        detail.status || "success",
        tokens.prompt_tokens || 0,
        tokens.completion_tokens || 0,
        tokens.cached_tokens || 0,
        tokens.cache_creation_input_tokens || 0,
        tokens.reasoning_tokens || 0,
        latency.total || 0,
        latency.ttft || 0,
      ]
    );
    await maybeCleanup(db);
  } catch (e) {
    console.error("[requestStats] save failed:", e);
  }
}

async function maybeCleanup(db) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const days = settings.statsRetentionDays || DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(now - days * DAY_MS).toISOString();
    db.run(`DELETE FROM requestStats WHERE timestamp < ?`, [cutoff]);
  } catch {}
}

// One-time backfill of the pre-existing usageHistory rows (they carry the same
// canonical token shape, but no latency — those columns stay 0). Runs on the
// first statistics read when the table is empty.
export async function ensureStatsBackfilled() {
  if (backfillStarted) return;
  backfillStarted = true;
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT COUNT(*) as c FROM requestStats`);
    if (row && row.c > 0) return;
    const meta = db.get(`SELECT value FROM _meta WHERE key = 'statsBackfilled'`);
    if (meta) return;
    db.transaction(() => {
      db.run(
        `INSERT INTO requestStats(id, timestamp, provider, model, connectionId, status,
           promptTokens, completionTokens, cachedTokens, cacheCreationTokens, reasoningTokens)
         SELECT 'bh-' || id, timestamp, provider, model, connectionId, status,
                promptTokens, completionTokens,
                COALESCE(json_extract(tokens, '$.cached_tokens'), json_extract(tokens, '$.cache_read_input_tokens'), 0),
                COALESCE(json_extract(tokens, '$.cache_creation_input_tokens'), 0),
                COALESCE(json_extract(tokens, '$.reasoning_tokens'), 0)
         FROM usageHistory`
      );
      db.run(`INSERT INTO _meta(key, value) VALUES('statsBackfilled', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    });
  } catch (e) {
    console.error("[requestStats] backfill failed:", e);
  }
}

export async function getStatsFilters() {
  await ensureStatsBackfilled();
  const db = await getAdapter();
  const connMap = await getConnectionMap();
  const providerNameMap = await getProviderNameMap();

  const rows = db.all(
    `SELECT DISTINCT provider, model, connectionId FROM requestStats
     WHERE provider IS NOT NULL OR model IS NOT NULL OR connectionId IS NOT NULL`
  );

  const providerSet = new Map();
  const modelSet = new Set();
  const accountSet = new Map();
  const accountsByProvider = new Map();
  const modelsByProvider = new Map();
  const modelsByAccount = new Map();

  const add = (map, key, val) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(val);
  };

  for (const r of rows) {
    const p = r.provider;
    const m = r.model;
    const c = r.connectionId;
    if (p) providerSet.set(p, { id: p, name: providerNameMap[p] || p });
    if (m) modelSet.add(m);
    if (c) accountSet.set(c, { id: c, name: connMap[c] || c });
    add(modelsByProvider, p, m);
    add(modelsByAccount, c, m);
    add(accountsByProvider, p, c);
  }

  const toSorted = (set) => [...set].sort((a, b) => String(a).localeCompare(String(b)));
  const toAccounts = (set) =>
    toSorted(set).map((id) => ({ id, name: connMap[id] || id }));

  return {
    providers: [...providerSet.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    models: toSorted(modelSet),
    accounts: [...accountSet.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    // Linkage maps so the UI can cascade Provider → Account → Model.
    accountsByProvider: Object.fromEntries([...accountsByProvider].map(([p, s]) => [p, toAccounts(s)])),
    modelsByProvider: Object.fromEntries([...modelsByProvider].map(([p, s]) => [p, toSorted(s)])),
    modelsByAccount: Object.fromEntries([...modelsByAccount].map(([c, s]) => [c, toSorted(s)])),
  };
}

export async function getStatsSummary(filter = {}) {
  await ensureStatsBackfilled();
  const db = await getAdapter();
  const { where, params } = buildStatsWhere(filter);
  const row = db.get(
    `SELECT COUNT(*) as requests,
            COALESCE(SUM(promptTokens), 0) as promptTokens,
            COALESCE(SUM(completionTokens), 0) as completionTokens,
            COALESCE(SUM(cachedTokens), 0) as cachedTokens,
            COALESCE(SUM(cacheCreationTokens), 0) as cacheCreationTokens,
            COALESCE(AVG(latencyTotal), 0) as avgLatency,
            COALESCE(AVG(latencyTtft), 0) as avgTtft
     FROM requestStats ${where}`,
    params
  );
  const requests = row.requests || 0;
  const prompt = row.promptTokens || 0;
  const cached = row.cachedTokens || 0;
  const created = row.cacheCreationTokens || 0;
  const inputOnly = Math.max(0, prompt - cached - created);
  const hitDenom = inputOnly + cached;
  return {
    totalRequests: requests,
    totalTokens: prompt + (row.completionTokens || 0),
    inputTokens: inputOnly,
    outputTokens: row.completionTokens || 0,
    cacheReadTokens: cached,
    cacheCreationTokens: created,
    cacheHitRate: hitDenom > 0 ? cached / hitDenom : 0,
    latency: {
      avgLatencyMs: row.avgLatency || 0,
      avgTtftMs: row.avgTtft || 0,
      requests,
    },
  };
}

// Auto-granularity series: the bucket width is derived from the actual data
// span (min..max timestamps), not the requested filter range, so a narrow real
// window yields fine buckets and the curve keeps ≥ MIN_SERIES_POINTS points.
export async function getStatsSeries(filter = {}) {
  await ensureStatsBackfilled();
  const db = await getAdapter();
  const { where, params } = buildStatsWhere(filter);
  const rows = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cachedTokens, cacheCreationTokens FROM requestStats ${where}`,
    params
  );
  if (!rows.length) return [];

  const times = rows.map((r) => new Date(r.timestamp).getTime()).filter(Number.isFinite);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, MIN_MS);
  // Coarsest bucket width that still fits ≥ MIN_SERIES_POINTS points across
  // the span (span/w + 1 >= MIN_SERIES_POINTS  ⇒  w <= span/MIN_SERIES_POINTS).
  const bucketMs = SERIES_BUCKET_MS.find((w) => w <= span / MIN_SERIES_POINTS) || MIN_MS;
  const start = Math.floor(min / bucketMs) * bucketMs;
  const end = Math.max(max, start + bucketMs);

  const isDay = bucketMs === DAY_MS;
  const isHour = bucketMs === HOUR_MS || bucketMs === 12 * HOUR_MS || bucketMs === 6 * HOUR_MS || bucketMs === 3 * HOUR_MS;
  const buckets = new Map();
  for (let t = start; t <= end; t += bucketMs) {
    const d = new Date(t);
    const label = isDay
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : isHour
        ? d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        : d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    buckets.set(t, { label, requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cacheHitRate: 0 });
  }

  for (const r of rows) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor(t / bucketMs) * bucketMs;
    const b = buckets.get(idx);
    if (!b) continue;
    const prompt = r.promptTokens || 0;
    const cached = r.cachedTokens || 0;
    const created = r.cacheCreationTokens || 0;
    const inputOnly = Math.max(0, prompt - cached - created);
    b.requests += 1;
    b.totalTokens += prompt + (r.completionTokens || 0);
    b.inputTokens += inputOnly;
    b.outputTokens += r.completionTokens || 0;
    b.cacheReadTokens += cached;
    b.cacheCreationTokens += created;
  }

  const out = [...buckets.values()];
  for (const b of out) {
    const denom = b.inputTokens + b.cacheReadTokens;
    b.cacheHitRate = denom > 0 ? b.cacheReadTokens / denom : 0;
  }
  return out;
}

export async function getStatsItems(filter = {}) {
  await ensureStatsBackfilled();
  const db = await getAdapter();
  const { where, params } = buildStatsWhere(filter);
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestStats ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, status,
            promptTokens, completionTokens, cachedTokens, cacheCreationTokens, reasoningTokens,
            latencyTotal, latencyTtft
     FROM requestStats ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const connectionMap = await getConnectionMap();
  const items = rows.map((r) => {
    const prompt = r.promptTokens || 0;
    const cached = r.cachedTokens || 0;
    const created = r.cacheCreationTokens || 0;
    const inputOnly = Math.max(0, prompt - cached - created);
    const hitDenom = inputOnly + cached;
    return {
      id: r.id,
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      account: connectionMap[r.connectionId] || r.connectionId || "",
      status: r.status || "success",
      inputTokens: inputOnly,
      outputTokens: r.completionTokens || 0,
      cacheReadTokens: cached,
      cacheCreationTokens: created,
      reasoningTokens: r.reasoningTokens || 0,
      cacheHitRate: hitDenom > 0 ? cached / hitDenom : 0,
      latencyMs: r.latencyTotal || 0,
      ttftMs: r.latencyTtft || 0,
    };
  });

  return {
    items,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}
