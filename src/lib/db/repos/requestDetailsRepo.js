import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

/**
 * Whether an environment variable has settled this, or null when none did.
 *
 * Read outside everything that can fail. It used to be decided inside the same
 * try as the settings read, so any error there — and the catch swallows all of
 * them — dropped the operator's explicit choice and disabled recording. On a
 * server whose dashboard is not reachable that is the only switch there is.
 */
function envObservability(env = process.env) {
  if (env.ENABLE_REQUEST_LOGS !== undefined) {
    return String(env.ENABLE_REQUEST_LOGS).toLowerCase() === "true";
  }
  if (env.OBSERVABILITY_ENABLED !== undefined) {
    return String(env.OBSERVABILITY_ENABLED).toLowerCase() !== "false";
  }
  return null;
}

function envNumber(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;

  const fromEnv = envObservability();
  let settings = {};
  try {
    const { getSettings } = await import("./settingsRepo.js");
    settings = (await getSettings()) || {};
  } catch {
    // Recording is not worth failing a request over, and the environment's
    // answer still stands when the settings table cannot be read.
    settings = {};
  }

  cachedConfig = {
    // The environment wins when it said anything; otherwise the dashboard's
    // own switch does, which is off until somebody turns it on.
    enabled: fromEnv !== null ? fromEnv : settings.enableObservability === true,
    maxRecords: settings.observabilityMaxRecords
      || envNumber(process.env.OBSERVABILITY_MAX_RECORDS, DEFAULT_MAX_RECORDS),
    batchSize: settings.observabilityBatchSize
      || envNumber(process.env.OBSERVABILITY_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    flushIntervalMs: settings.observabilityFlushIntervalMs
      || envNumber(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS, DEFAULT_FLUSH_INTERVAL_MS),
    maxJsonSize: (settings.observabilityMaxJsonSize
      || envNumber(process.env.OBSERVABILITY_MAX_JSON_SIZE, 5)) * 1024,
  };
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
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

export const __test__ = { sanitizeHeaders };

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

/**
 * `providerRequest`, with the conversation's shape kept even when the rest of
 * it is too large to store.
 *
 * The shape is turn counts, tool names and ids, block types and text lengths —
 * no message content, and the thing a looping client is actually diagnosed
 * from. Truncating the field wholesale dropped it precisely for the long
 * tool-heavy conversations that are worth diagnosing, leaving a preview of the
 * first 200 characters instead.
 */
function truncateProviderRequest(providerRequest, maxSize) {
  const truncated = truncateField(providerRequest, maxSize);
  if (!truncated?._truncated) return truncated;
  const shape = providerRequest?.conversation;
  if (!shape) return truncated;
  const kept = { ...truncated, conversation: shape };
  // Unless the shape alone is the thing that is too big, in which case there
  // is nothing to do but say so.
  return JSON.stringify(kept).length > maxSize ? truncated : kept;
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();

      db.transaction(() => {
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(item.model);
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

          const record = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, config.maxJsonSize),
            providerRequest: truncateProviderRequest(item.providerRequest, config.maxJsonSize),
            providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
            response: truncateField(item.response, config.maxJsonSize),
            pxpipe: item.pxpipe || undefined,
          };

          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
          );
        }

        const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
        if (cnt && cnt.c > config.maxRecords) {
          db.run(
            `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
            [cnt.c - config.maxRecords]
          );
        }
      });
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

/**
 * Whether requests are being recorded at all.
 *
 * Off is the default, and an empty Request Details tab looks exactly like a
 * server that has served nothing — so the tab has to be able to tell the two
 * apart and say which it is.
 */
export async function isObservabilityRecording() {
  return (await getObservabilityConfig()).enabled === true;
}

/**
 * The name of the environment variable that settled it, or null when the
 * dashboard's own switch did.
 *
 * Telling an operator to flip a switch that an environment variable is already
 * overriding is advice that cannot work — and `.env.example` used to ship
 * exactly that pair, so this is the case that wasted the most time.
 */
export function observabilityEnvSource(env = process.env) {
  if (env.ENABLE_REQUEST_LOGS !== undefined) return "ENABLE_REQUEST_LOGS";
  if (env.OBSERVABILITY_ENABLED !== undefined) return "OBSERVABILITY_ENABLED";
  return null;
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
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
