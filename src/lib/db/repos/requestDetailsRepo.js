import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;
const MAX_FIELD_JSON_SIZE = 64 * 1024;
const KIRO_MAX_FIELD_JSON_SIZE = 16 * 1024;
const MIN_FIELD_JSON_SIZE = 1024;
const MIN_BUFFER_LIMIT = 100;
const MAX_BUFFER_LIMIT = 1000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled = typeof settings.enableObservability2 === "boolean"
      ? settings.enableObservability2
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
let hasWarnedBufferLimit = false;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value ?? {}, (_key, nestedValue) => {
    if (typeof nestedValue === "bigint") return nestedValue.toString();
    if (nestedValue && typeof nestedValue === "object") {
      if (seen.has(nestedValue)) return "[Circular]";
      seen.add(nestedValue);
    }
    return nestedValue;
  });
}

function getFieldSizeLimit(provider, configuredSize) {
  const hardLimit = provider === "kiro" ? KIRO_MAX_FIELD_JSON_SIZE : MAX_FIELD_JSON_SIZE;
  const normalizedSize = Number.isFinite(configuredSize) ? configuredSize : DEFAULT_MAX_JSON_SIZE;
  return Math.max(MIN_FIELD_JSON_SIZE, Math.min(normalizedSize, hardLimit));
}

async function getApiKeyName(apiKey) {
  if (!apiKey) return null;
  try {
    const { getApiKeys } = await import("./apiKeysRepo.js");
    const key = (await getApiKeys()).find((item) => item.key === apiKey);
    return key?.name || `${apiKey.slice(0, 8)}...`;
  } catch {
    return `${apiKey.slice(0, 8)}...`;
  }
}

export function compactRequestDetail(detail, configuredMaxSize = DEFAULT_MAX_JSON_SIZE) {
  const maxSize = getFieldSizeLimit(detail?.provider, configuredMaxSize);
  const compactField = (value) => {
    try {
      const serialized = safeStringify(value);
      if (serialized.length > maxSize) {
        return {
          _truncated: true,
          _originalSize: serialized.length,
          _preview: serialized.substring(0, 200),
        };
      }
      return JSON.parse(serialized);
    } catch (error) {
      return {
        _truncated: true,
        _serializationError: error.message,
      };
    }
  };

  const request = detail?.request && typeof detail.request === "object"
    ? { ...detail.request, headers: sanitizeHeaders(detail.request.headers) }
    : detail?.request;

  return {
    id: detail?.id || generateDetailId(detail?.model),
    provider: detail?.provider || null,
    model: detail?.model || null,
    connectionId: detail?.connectionId || null,
    apiKeyName: detail?.apiKeyName || null,
    timestamp: detail?.timestamp || new Date().toISOString(),
    status: detail?.status || null,
    latency: compactField(detail?.latency),
    tokens: compactField(detail?.tokens),
    request: compactField(request),
    providerRequest: compactField(detail?.providerRequest),
    providerResponse: compactField(detail?.providerResponse),
    response: compactField(detail?.response),
  };
}

function getBufferLimit(batchSize) {
  return Math.min(MAX_BUFFER_LIMIT, Math.max(MIN_BUFFER_LIMIT, batchSize * 4));
}

function enqueueDetail(detail, config) {
  const bufferLimit = getBufferLimit(config.batchSize);
  if (writeBuffer.length >= bufferLimit) {
    writeBuffer.splice(0, writeBuffer.length - bufferLimit + 1);
    if (!hasWarnedBufferLimit) {
      hasWarnedBufferLimit = true;
      console.warn(`[requestDetailsRepo] Buffer limit reached (${bufferLimit}); dropping oldest observability records`);
    }
  }
  writeBuffer.push(compactRequestDetail(detail, config.maxJsonSize));
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    const config = await getObservabilityConfig();
    const items = writeBuffer.splice(0, Math.max(1, config.batchSize));
    const db = await getAdapter();

    db.transaction(() => {
      for (const item of items) {
        db.run(
          `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
          [item.id, item.timestamp, item.provider, item.model, item.connectionId, item.status, stringifyJson(item)]
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
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
    if (writeBuffer.length === 0) {
      hasWarnedBufferLimit = false;
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushToDatabase().catch(() => {});
      }, 0);
    }
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  enqueueDetail({ ...detail, apiKeyName: detail?.apiKeyName || await getApiKeyName(detail?.apiKey) }, config);

  // Trigger immediate flush at the threshold; remaining records are scheduled
  // as another batch so sustained traffic cannot monopolize the event loop.
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
