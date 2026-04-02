import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024; // 5KB default, configurable via settings
const CONFIG_CACHE_TTL_MS = 5000;
const MAX_TOTAL_DB_SIZE = 50 * 1024 * 1024; // 50MB hard limit for total DB file

function getAppName() {
  return "9router";
}

function getUserDataDir() {
  if (isCloud) return "/tmp";
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os.homedir();
  const appName = getAppName();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
  }
  return path.join(homeDir, `.${appName}`);
}

const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "request-details.json");

if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbInstance = null;

async function getDb() {
  if (isCloud) return null;
  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    const db = new Low(adapter, { records: [] });
    await db.read();
    if (!db.data?.records) db.data = { records: [] };
    dbInstance = db;
  }
  return dbInstance;
}

// Config cache
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

// Batch write queue
let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function safeJsonStringify(obj, maxSize) {
  try {
    const str = JSON.stringify(obj);
    if (str.length > maxSize) {
      return JSON.stringify({ _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) });
    }
    return str;
  } catch {
    return "{}";
  }
}

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

async function flushToDatabase() {
  if (isCloud || isFlushing || writeBuffer.length === 0) return;

  isFlushing = true;
  try {
    const itemsToSave = [...writeBuffer];
    writeBuffer = [];

    const db = await getDb();
    const config = await getObservabilityConfig();

    for (const item of itemsToSave) {
      if (!item.id) item.id = generateDetailId(item.model);
      if (!item.timestamp) item.timestamp = new Date().toISOString();
      if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

      // Serialize large fields
      const record = {
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
      };

      // Truncate oversized JSON fields
      const maxSize = config.maxJsonSize;
      for (const field of ["request", "providerRequest", "providerResponse", "response"]) {
        const str = JSON.stringify(record[field]);
        if (str.length > maxSize) {
          record[field] = { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
        }
      }

      // Upsert: replace existing record with same id
      const idx = db.data.records.findIndex(r => r.id === record.id);
      if (idx !== -1) {
        db.data.records[idx] = record;
      } else {
        db.data.records.push(record);
      }
    }

    // Keep only latest maxRecords (sorted by timestamp desc)
    db.data.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (db.data.records.length > config.maxRecords) {
      db.data.records = db.data.records.slice(0, config.maxRecords);
    }

    // Shrink records until total serialized size is within safe limit
    while (db.data.records.length > 1) {
      const totalSize = Buffer.byteLength(JSON.stringify(db.data), "utf8");
      if (totalSize <= MAX_TOTAL_DB_SIZE) break;
      db.data.records = db.data.records.slice(0, Math.floor(db.data.records.length / 2));
    }

    await db.write();
  } catch (error) {
    console.error("[requestDetailsDb] Batch write failed:", error);
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

export async function getRequestDetails(filter = {}) {
  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  const db = await getDb();
  let records = [...db.data.records];

  // Apply filters
  if (filter.provider) records = records.filter(r => r.provider === filter.provider);
  if (filter.model) records = records.filter(r => r.model === filter.model);
  if (filter.connectionId) records = records.filter(r => r.connectionId === filter.connectionId);
  if (filter.status) records = records.filter(r => r.status === filter.status);
  if (filter.startDate) records = records.filter(r => new Date(r.timestamp) >= new Date(filter.startDate));
  if (filter.endDate) records = records.filter(r => new Date(r.timestamp) <= new Date(filter.endDate));

  // Sort desc
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalItems = records.length;
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const details = records.slice((page - 1) * pageSize, page * pageSize);

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id) {
  if (isCloud) return null;

  const db = await getDb();
  return db.data.records.find(r => r.id === id) || null;
}

// Graceful shutdown — use named handler so we can remove it on re-registration
const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
  if (isCloud) return;

  // Remove any previously registered listeners from this module (hot-reload safety)
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
