import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  const envLogs = process.env.ENABLE_REQUEST_LOGS;
  const envObs = process.env.OBSERVABILITY_ENABLED;
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS && cachedConfig._envLogs === envLogs && cachedConfig._envObs === envObs) {
    return cachedConfig;
  }
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();

    const envRequestLogs = process.env.ENABLE_REQUEST_LOGS;
    if (envRequestLogs !== undefined) {
      const enabled = envRequestLogs.toLowerCase() === "true";
      cachedConfig = {
        _envLogs: envLogs,
        _envObs: envObs,
        enabled,
        maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
        batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
        flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
        maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const enabled = uiFlag
      ? settings.enableObservability
      : envFallback;

    cachedConfig = {
      _envLogs: envLogs,
      _envObs: envObs,
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      _envLogs: envLogs,
      _envObs: envObs,
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
let flushingPromise = null;
const pendingAdmissions = new Set();

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

// Persist one batch in a single transaction. Fully synchronous (every DB
// adapter runs sync), so both the async flush loop and the sync "exit" handler
// share one code path — the exit path cannot afford an await.
function persistBatchSync(db, items, config) {
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
        providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
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

function flushConfigSync() {
  // During "exit" there is no event loop to await getObservabilityConfig().
  // If the buffer has items, admission already resolved a config, so the cache
  // is present; defaults keep this total if it somehow isn't.
  return cachedConfig || { maxJsonSize: DEFAULT_MAX_JSON_SIZE, maxRecords: DEFAULT_MAX_RECORDS };
}

// Sync flush for the "exit" event (T1.4 L-1): Node fires "exit" listeners with
// the event loop already stopped — an async flush there can NEVER complete and
// only gave false security. Everything here is synchronous: getAdapterSync +
// cached config + persistBatchSync. If the adapter was never opened (or an
// in-flight async flush already spliced its items away) there is nothing a
// stopped loop can do; log and keep the exit path crash-free.
function flushToDatabaseSync() {
  try {
    if (writeBuffer.length === 0) return;
    const db = getAdapterSync();
    const config = flushConfigSync();
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      try {
        persistBatchSync(db, items, config);
      } catch (err) {
        writeBuffer.unshift(...items);
        console.error("[requestDetailsRepo] exit flush batch failed:", err?.message || err);
        return;
      }
    }
  } catch (e) {
    console.error("[requestDetailsRepo] exit flush failed:", e?.message || e);
  }
}

async function flushToDatabase() {
  if (flushingPromise) {
    await flushingPromise;
    if (writeBuffer.length === 0) return;
  }

  flushingPromise = (async () => {
    try {
      // Drain entire buffer (loop in case more pushed during await)
      while (writeBuffer.length > 0) {
        const items = writeBuffer.splice(0, writeBuffer.length);
        try {
          const db = await getAdapter();
          const config = await getObservabilityConfig();
          persistBatchSync(db, items, config);
        } catch (err) {
          writeBuffer.unshift(...items);
          console.error("[requestDetailsRepo] Batch write failed:", err?.message || err);
          throw err;
        }
      }
    } finally {
      flushingPromise = null;
    }
  })();

  return flushingPromise;
}

export async function saveRequestDetail(detail) {
  if (!detail) return;

  let config = null;
  const admissionPromise = (async () => {
    try {
      config = await getObservabilityConfig();
      if (config && config.enabled) {
        writeBuffer.push(detail);
      }
    } catch (e) {
      console.error("[requestDetailsRepo] save admission err:", e);
    }
  })();

  pendingAdmissions.add(admissionPromise);
  try {
    await admissionPromise;
  } finally {
    pendingAdmissions.delete(admissionPromise);
  }

  if (config && config.enabled) {
    const batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
    const flushIntervalMs = config.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;

    // Trigger immediate flush if batch threshold reached.
    // flushToDatabase() drains the whole buffer in a loop, so entries pushed
    // while it awaits are persisted by the same run.
    if (writeBuffer.length >= batchSize) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushToDatabase().catch(() => {});
      }, flushIntervalMs);
    }
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

// beforeExit: the event loop is still alive — the async flush works there and
// also drains admissions still in flight.
const _beforeExitHandler = () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) flushToDatabase().catch(() => {});
};

// exit: the event loop is gone — only a fully synchronous flush can complete
// (T1.4 L-1). The old handler started flushToDatabase() here, an async promise
// that could never resolve, i.e. false security for scripts/one-off tooling
// that call process.exit().
const _exitHandler = () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) flushToDatabaseSync();
};

// SIGINT/SIGTERM are deliberately NOT handled here: the shutdown coordinator
// owns them and calls flushRequestDetailsNow(), which AWAITS the flush. A second
// handler firing in parallel would only start an unawaited flush racing that
// one. beforeExit/exit stay, so an orderly exit without a coordinator (scripts,
// one-off tooling) still drains the buffer — the exit path synchronously.
function ensureShutdownHandler() {
  if (global._requestDetailsShutdownHandler) {
    process.off("beforeExit", global._requestDetailsShutdownHandler.beforeExit);
    process.off("exit", global._requestDetailsShutdownHandler.exit);
  }
  global._requestDetailsShutdownHandler = { beforeExit: _beforeExitHandler, exit: _exitHandler };
  process.on("beforeExit", _beforeExitHandler);
  process.on("exit", _exitHandler);
}

/**
 * Flush buffered request details now. Used by the shutdown coordinator so a
 * signal drains the buffer instead of trusting the pending flush timer.
 * Never throws; returns the number of records still buffered (0 when drained).
 */
export async function flushRequestDetailsNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pendingAdmissions.size > 0) {
    await Promise.allSettled(Array.from(pendingAdmissions));
  }
  try {
    await flushToDatabase();
  } catch (e) {
    console.error("[requestDetailsRepo] shutdown flush failed:", e?.message || e);
  }
  return writeBuffer.length;
}

// SIGINT/SIGTERM are deliberately NOT handled here: the shutdown coordinator
// owns them and calls flushRequestDetailsNow(), which AWAITS the flush. A second
// handler firing in parallel would only start an unawaited flush racing that
// one. beforeExit/exit stay, so an orderly exit without a coordinator (scripts,
// one-off tooling) still drains the buffer.
ensureShutdownHandler();
