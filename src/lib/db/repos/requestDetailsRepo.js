import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { isTimsliteDataStoreEnabled } from "@/lib/timslite/requestDetailsStore.js";
import {
  registerShutdownStep,
  hasShutdownStep,
  ShutdownPhase,
} from "@/lib/runtime/shutdownCoordinator.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envRequestLogs = process.env.ENABLE_REQUEST_LOGS;
    if (envRequestLogs !== undefined) {
      const enabled = envRequestLogs.toLowerCase() === "true";
      cachedConfig = {
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
let flushPromise = null;
let storeFactory = null;
let timsliteStore = null;
let shutdownPromise = null;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

export const __test__ = {
  sanitizeHeaders,
  flushNow: () => flushToDatabase(),
  setStoreFactory: (factory) => { storeFactory = factory; },
  ensureShutdownStep: ensureRequestDetailsShutdownStep,
  shutdownNow: async () => {
    try {
      await performShutdown();
    } finally {
      resetEphemeralState();
    }
  },
  resetState: () => {
    resetEphemeralState();
    const stores = detachTimsliteStores();
    for (const store of stores) {
      if (store.discard) {
        Promise.resolve(store.discard()).catch((error) => {
          console.warn("[requestDetailsRepo] Timslite test reset discard failed:", error);
        });
      }
      if (store.close) {
        Promise.resolve(store.close()).catch((error) => {
          console.warn("[requestDetailsRepo] Timslite test reset close failed:", error);
        });
      }
    }
  },
};

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

function flushToDatabase() {
  if (flushPromise) return flushPromise;
  if (writeBuffer.length === 0) return Promise.resolve();
  flushPromise = drainWriteBuffer();
  return flushPromise;
}

async function drainWriteBuffer() {
  try {
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();

      const dropProviderPayloads = process.env.OBSERVABILITY_DATA_PROVIDER_DROP === "true";
      const timsliteEnabled = isTimsliteDataStoreEnabled(process.env);
      let useTimslite = false;
      const stagedItems = [];

      if (timsliteEnabled) {
        try {
          timsliteStore = await getTimsliteStore({ forWrite: true });

          if (timsliteStore && timsliteStore.enabled) {
            useTimslite = true;
            for (const item of items) {
              if (!item.id) item.id = generateDetailId(item.model);
              if (!item.timestamp) item.timestamp = new Date().toISOString();
              if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

              const fullRecord = {
                id: item.id,
                provider: item.provider || null,
                model: item.model || null,
                connectionId: item.connectionId || null,
                timestamp: item.timestamp,
                status: item.status || null,
                latency: item.latency || {},
                tokens: item.tokens || {},
                request: item.request || {},
                providerRequest: item.providerRequest || {},
                providerResponse: item.providerResponse || {},
                response: item.response || {},
                pxpipe: item.pxpipe || undefined,
              };

              if (dropProviderPayloads) {
                delete fullRecord.providerRequest;
                delete fullRecord.providerResponse;
              }

              try {
                const pointer = await timsliteStore.stage(fullRecord);
                if (pointer && pointer.timslite_id) {
                  stagedItems.push({
                    id: item.id,
                    timestamp: item.timestamp,
                    provider: item.provider ?? null,
                    model: item.model ?? null,
                    connectionId: item.connectionId ?? null,
                    status: item.status ?? null,
                    timslite_id: pointer.timslite_id,
                  });
                } else {
                  useTimslite = false;
                  break;
                }
              } catch (err) {
                console.warn("[requestDetailsRepo] Timslite stage failed; using inline fallback:", err.message);
                useTimslite = false;
                break;
              }
            }

            if (useTimslite) {
              try {
                await timsliteStore.flush();
              } catch (err) {
                console.warn("[requestDetailsRepo] Timslite flush failed; using inline fallback:", err.message);
                useTimslite = false;
              }
            }
          }
        } catch (err) {
          console.warn("[requestDetailsRepo] Timslite initialization failed; using inline fallback:", err.message);
          useTimslite = false;
        }

        if (!useTimslite && timsliteStore) {
          try {
            if (timsliteStore.discard) {
              await timsliteStore.discard();
            }
            await timsliteStore.close();
          } catch (cleanupErr) {
            console.warn("[requestDetailsRepo] Timslite cleanup failed:", cleanupErr);
          }
          timsliteStore = null;
        }
      }

      db.transaction(() => {
        if (useTimslite && stagedItems.length === items.length) {
          for (const staged of stagedItems) {
            db.run(
              `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
              [staged.id, staged.timestamp, staged.provider, staged.model, staged.connectionId, staged.status, stringifyJson({ timslite_id: staged.timslite_id })]
            );
          }
        } else {
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

            if (dropProviderPayloads) {
              delete record.providerRequest;
              delete record.providerResponse;
            }

            db.run(
              `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
              [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
            );
          }
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
    flushPromise = null;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  writeBuffer.push(structuredClone(detail));

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

function isValidPointer(parsed) {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 1 &&
    typeof parsed.timslite_id === "string"
  );
}

function isPointerLike(parsed) {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "timslite_id" in parsed
  );
}

function makeUnavailable(row, timsliteId, errorMsg) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    connectionId: row.connectionId,
    status: row.status,
    timslite_id: timsliteId,
    detailUnavailable: true,
    detailError: errorMsg,
  };
}

async function getTimsliteStore({ forWrite = false } = {}) {
  if (timsliteStore && (!forWrite || timsliteStore.enabled)) return timsliteStore;
  try {
    if (timsliteStore) {
      await timsliteStore.close();
      timsliteStore = null;
    }
    if (storeFactory) {
      timsliteStore = storeFactory();
      return timsliteStore;
    }
    const { createRequestDetailsStore } = await import("@/lib/timslite/requestDetailsStore.js");
    timsliteStore = createRequestDetailsStore({ env: process.env });
    return timsliteStore;
  } catch (err) {
    console.warn("[requestDetailsRepo] Timslite store init failed:", err.message);
    return null;
  }
}

async function hydratePointerRow(row, parsed) {
  const timsliteId = parsed.timslite_id;

  if (!/^\d+$/.test(timsliteId)) {
    return makeUnavailable(row, timsliteId, "Malformed timslite_id: not a decimal string");
  }

  try {
    const store = await getTimsliteStore();
    if (!store) {
      return makeUnavailable(row, timsliteId, "Timslite store unavailable");
    }

    const result = await store.getMany([timsliteId]);
    const payload = result.get(timsliteId);

    if (!payload) {
      return makeUnavailable(row, timsliteId, "Payload not found in Timslite");
    }

    return {
      ...payload,
      id: row.id,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      connectionId: row.connectionId,
      status: row.status,
      timslite_id: timsliteId,
    };
  } catch (err) {
    return makeUnavailable(row, timsliteId, err.message || "Timslite read failed");
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

  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize || 20));
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT id, timestamp, provider, model, connectionId, status, data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const pointerIds = [];
  const rowMap = new Map();
  for (const r of rows) {
    const parsed = parseJson(r.data, {});
    if (isPointerLike(parsed)) {
      if (isValidPointer(parsed)) {
        pointerIds.push(parsed.timslite_id);
        rowMap.set(r.id, { row: r, parsed, isPointer: true });
      } else {
        rowMap.set(r.id, { row: r, parsed, isMalformed: true });
      }
    } else {
      rowMap.set(r.id, { row: r, parsed, isInline: true });
    }
  }

  let hydratedData = new Map();
  if (pointerIds.length > 0) {
    try {
      const store = await getTimsliteStore();
      if (store) {
        hydratedData = await store.getMany([...new Set(pointerIds)], { resolveValues: false });
      }
    } catch (err) {
      console.warn("[requestDetailsRepo] Timslite batch read failed:", err.message);
    }
  }

  const details = [];
  for (const r of rows) {
    const entry = rowMap.get(r.id);
    if (entry.isInline) {
      details.push({ ...entry.parsed });
    } else if (entry.isMalformed) {
      const timsliteId = entry.parsed.timslite_id;
      const idType = typeof timsliteId;
      const errorMsg = idType !== "string"
        ? `Malformed timslite_id: expected string, got ${idType}`
        : "Malformed pointer: extra keys present";
      details.push(makeUnavailable(entry.row, timsliteId, errorMsg));
    } else {
      const timsliteId = entry.parsed.timslite_id;
      if (!/^\d+$/.test(timsliteId)) {
        details.push(makeUnavailable(entry.row, timsliteId, "Malformed timslite_id: not a decimal string"));
      } else {
        const payload = hydratedData.get(timsliteId);
        if (!payload) {
          details.push(makeUnavailable(entry.row, timsliteId, "Payload not found in Timslite"));
        } else {
          details.push({
            ...payload,
            id: entry.row.id,
            timestamp: entry.row.timestamp,
            provider: entry.row.provider,
            model: entry.row.model,
            connectionId: entry.row.connectionId,
            status: entry.row.status,
            timslite_id: timsliteId,
          });
        }
      }
    }
  }

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
  const row = db.get(`SELECT id, timestamp, provider, model, connectionId, status, data FROM requestDetails WHERE id = ?`, [id]);
  if (!row) return null;

  const parsed = parseJson(row.data, null);
  if (parsed === null) return null;

  if (isPointerLike(parsed)) {
    if (isValidPointer(parsed)) {
      return hydratePointerRow(row, parsed);
    }
    const timsliteId = parsed.timslite_id;
    const idType = typeof timsliteId;
    const errorMsg = idType !== "string"
      ? `Malformed timslite_id: expected string, got ${idType}`
      : "Malformed pointer: extra keys present";
    return makeUnavailable(row, timsliteId, errorMsg);
  }

  return parsed;
}

function clearFlushTimer() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function resetEphemeralState() {
  const activeFlush = flushPromise;
  writeBuffer = [];
  clearFlushTimer();
  cachedConfig = null;
  cachedConfigTs = 0;
  storeFactory = null;
  shutdownPromise = null;
  if (!activeFlush) {
    flushPromise = null;
    return;
  }
  Promise.resolve(activeFlush).finally(() => {
    if (flushPromise === activeFlush) flushPromise = null;
  });
}

function detachTimsliteStores() {
  const stores = [];
  if (timsliteStore) {
    stores.push(timsliteStore);
    timsliteStore = null;
  }
  return stores;
}

async function closeTimsliteStores(stores) {
  const closed = new Set();
  for (const store of stores) {
    if (!store || closed.has(store) || typeof store.close !== "function") continue;
    closed.add(store);
    try {
      await store.close();
    } catch (error) {
      console.warn("[requestDetailsRepo] Timslite store close failed:", error);
    }
  }
}

async function performShutdown() {
  clearFlushTimer();
  await flushToDatabase();
  if (writeBuffer.length > 0) {
    await flushToDatabase();
  }
  await closeTimsliteStores(detachTimsliteStores());
}

// Narrow lifecycle hook: drains pending writes then closes both Timslite
// process-local Timslite store. Idempotent — repeated
// calls reuse the same in-flight promise.
export function shutdownRequestDetails() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = performShutdown();
  return shutdownPromise;
}

const SHUTDOWN_STEP_NAME = "request-details";

// Registered at the coordinator's FLUSH phase so pending Timslite batches and
// their SQLite pointer rows are persisted before any adapter closes the DB.
export function ensureRequestDetailsShutdownStep() {
  if (hasShutdownStep(SHUTDOWN_STEP_NAME)) return;
  registerShutdownStep(
    SHUTDOWN_STEP_NAME,
    () => shutdownRequestDetails(),
    { phase: ShutdownPhase.FLUSH }
  );
}

ensureRequestDetailsShutdownStep();
