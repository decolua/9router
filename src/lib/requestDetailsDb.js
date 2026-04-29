// Request-details (full request/response trace) facade. SQLite-backed on
// Node; no-op on Workers. Preserves the existing batched-write pattern:
// callers push into an in-memory buffer and a single transactional INSERT
// runs on batch threshold or after a debounce timer.

import { getDatabase } from "./sqlite/connection.js";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;


let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled = typeof settings.enableObservability === "boolean"
      ? settings.enableObservability
      : envEnabled;
    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateIfLarge(obj, maxSize) {
  const str = JSON.stringify(obj);
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj;
}

// Returns a flat { id, ts, provider, ... latency_ms, prompt, completion, dataBlob } row.
function prepareRecord(item, maxSize) {
  if (!item.id) item.id = generateDetailId(item.model);
  if (!item.timestamp) item.timestamp = new Date().toISOString();
  if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

  const payload = {
    latency: item.latency || {},
    tokens: item.tokens || {},
    request: truncateIfLarge(item.request || {}, maxSize),
    providerRequest: truncateIfLarge(item.providerRequest || {}, maxSize),
    providerResponse: truncateIfLarge(item.providerResponse || {}, maxSize),
    response: truncateIfLarge(item.response || {}, maxSize),
  };

  const latency = typeof item.latency === "number"
    ? item.latency
    : (item.latency?.total ?? item.latency?.totalMs ?? null);
  const t = item.tokens || {};
  return {
    id: item.id,
    timestamp: item.timestamp,
    provider: item.provider || null,
    model: item.model || null,
    connectionId: item.connectionId || null,
    status: item.status || null,
    latency_ms: latency,
    prompt_tokens: t.prompt_tokens ?? t.input_tokens ?? null,
    completion_tokens: t.completion_tokens ?? t.output_tokens ?? null,
    data: JSON.stringify(payload),
  };
}

async function flushToDatabase() {
  if (isCloud || isFlushing || writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    const items = writeBuffer;
    writeBuffer = [];
    const config = await getObservabilityConfig();
    const db = getDatabase();

    const insert = db.prepare(`
      INSERT OR REPLACE INTO request_details
      (id, timestamp, provider, model, connection_id, status, latency_ms,
       prompt_tokens, completion_tokens, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = db.transaction(() => {
      for (const item of items) {
        const r = prepareRecord(item, config.maxJsonSize);
        insert.run(
          r.id, r.timestamp, r.provider, r.model, r.connectionId, r.status,
          r.latency_ms, r.prompt_tokens, r.completion_tokens, r.data,
        );
      }
      // Trim to maxRecords (keep newest).
      db.prepare(`
        DELETE FROM request_details
        WHERE id IN (
          SELECT id FROM request_details
          ORDER BY timestamp DESC
          LIMIT -1 OFFSET ?
        )
      `).run(config.maxRecords);
    });
    run();
  } catch (err) {
    console.error("[requestDetailsDb] Batch write failed:", err);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  if (isCloud) return;
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  if (writeBuffer.length >= config.batchSize) {
    await flushToDatabase();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => {});
      flushTimer = null;
    }, config.flushIntervalMs);
  }
}

function rowToDetail(r) {
  let payload = {};
  try { payload = JSON.parse(r.data || "{}"); } catch {}
  return {
    id: r.id,
    timestamp: r.timestamp,
    provider: r.provider,
    model: r.model,
    connectionId: r.connection_id,
    status: r.status,
    latency: payload.latency ?? (r.latency_ms != null ? { total: r.latency_ms } : {}),
    tokens: payload.tokens ?? {
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
    },
    request: payload.request ?? {},
    providerRequest: payload.providerRequest ?? {},
    providerResponse: payload.providerResponse ?? {},
    response: payload.response ?? {},
  };
}

export async function getRequestDetails(filter = {}) {
  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }
  const db = getDatabase();

  const clauses = [];
  const params = [];
  if (filter.provider) { clauses.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { clauses.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { clauses.push("connection_id = ?"); params.push(filter.connectionId); }
  if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { clauses.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { clauses.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM request_details ${where}`).get(...params);
  const totalItems = countRow?.c || 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);

  const rows = db.prepare(`
    SELECT * FROM request_details ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  return {
    details: rows.map(rowToDetail),
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id) {
  if (isCloud) return null;
  const db = getDatabase();
  const r = db.prepare("SELECT * FROM request_details WHERE id = ?").get(id);
  return r ? rowToDetail(r) : null;
}

// Graceful shutdown — flush pending buffer before exit.
const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
  if (isCloud) return;
  process.off("beforeExit", _shutdownHandler);
  process.off("SIGINT", _shutdownHandler);
  process.off("SIGTERM", _shutdownHandler);
  process.off("exit", _shutdownHandler);
  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}

ensureShutdownHandler();
