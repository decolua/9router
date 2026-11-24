import { randomUUID } from "node:crypto";
import { BODY_FIELDS, detailMetadata, redactLogValue } from "../../observability/logPrivacy.js";
import { DAY_MS } from "../logRetention.js";
import { currentInference } from "../../observability/requestContext.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
// Configuration is read in the writer's transaction, including cross-process revocation.
function configFor(db) {
  const settings = parseJson(db.get("SELECT data FROM settings WHERE id=1")?.data, {});
  const numeric = (key, env, fallback) => {
    const value = Number(settings[key] ?? process.env[env] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  return {
    enabled: process.env.ENABLE_REQUEST_LOGS !== undefined ? process.env.ENABLE_REQUEST_LOGS.toLowerCase() === "true"
      : settings.enableObservability ?? process.env.OBSERVABILITY_ENABLED !== "false",
    maxRecords: numeric("observabilityMaxRecords", "OBSERVABILITY_MAX_RECORDS", DEFAULT_MAX_RECORDS),
    batchSize: numeric("observabilityBatchSize", "OBSERVABILITY_BATCH_SIZE", DEFAULT_BATCH_SIZE),
    flushIntervalMs: numeric("observabilityFlushIntervalMs", "OBSERVABILITY_FLUSH_INTERVAL_MS", DEFAULT_FLUSH_INTERVAL_MS),
    maxJsonSize: numeric("observabilityMaxJsonSize", "OBSERVABILITY_MAX_JSON_SIZE", DEFAULT_MAX_JSON_SIZE / 1024) * 1024,
    until: Date.parse(settings.debugBodyLoggingUntil) > Date.now() ? settings.debugBodyLoggingUntil : null,
  };
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
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
      db.transaction(() => {
        const config = configFor(db);
        if (!config.enabled && !config.until) return;
        for (const { metadata, bodies, until } of items) {
          const capture = bodies && until === config.until && Date.parse(until) > Date.now();
          if (!capture && !config.enabled) continue;
          const record = capture ? { ...metadata, ...bodies } : metadata;
          const expires = capture ? new Date(Date.parse(until) + DAY_MS).toISOString() : null;
          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data, bodyExpiresAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data, bodyExpiresAt = excluded.bodyExpiresAt`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record), expires]
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

export async function saveRequestDetail(detail) {
  const trace = currentInference();
  const db = await getAdapter();
  const config = configFor(db);
  if (!config.enabled && !config.until) return;

  const metadata = detailMetadata({
    ...detail, id: trace?.requestId || detail.id || randomUUID(), timestamp: detail.timestamp || new Date().toISOString(),
    errorCategory: detail.errorCategory ?? trace?.failure?.category,
  });
  const bodies = config.until ? Object.fromEntries(BODY_FIELDS.filter(k => detail[k] != null)
    .map(k => [k, truncateField(redactLogValue(detail[k]), config.maxJsonSize)])) : null;
  writeBuffer.push({ metadata, bodies, until: config.until });

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flushToDatabase();
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

  if (filter.requestId) { conds.push("id = ?"); params.push(filter.requestId); }
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
