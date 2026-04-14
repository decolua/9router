import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const MAX_RECORDS = 500;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 3000;

function getUserDataDir() {
  if (isCloud) return "/tmp";
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const homeDir = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "9router");
  }
  return path.join(homeDir, ".9router");
}

const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "error-history.json");

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

// Batch write queue
let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

async function flushToDatabase() {
  if (isCloud || isFlushing || writeBuffer.length === 0) return;

  isFlushing = true;
  try {
    const items = [...writeBuffer];
    writeBuffer = [];

    const db = await getDb();

    for (const item of items) {
      db.data.records.push(item);
    }

    // Sort desc by timestamp, prune to max
    db.data.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (db.data.records.length > MAX_RECORDS) {
      db.data.records = db.data.records.slice(0, MAX_RECORDS);
    }

    await db.write();
  } catch (err) {
    console.error("[errorHistoryDb] Batch write failed:", err.message);
  } finally {
    isFlushing = false;
  }
}

/**
 * Save an error record to history.
 */
export async function saveErrorRecord({ connectionId, connectionName, provider, model, statusCode, errorMessage, notified = false }) {
  if (isCloud) return;

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    connectionId,
    connectionName: connectionName || connectionId,
    provider,
    model,
    statusCode,
    errorMessage: typeof errorMessage === "string" ? errorMessage.slice(0, 500) : String(errorMessage),
    timestamp: new Date().toISOString(),
    notified,
  };

  writeBuffer.push(record);

  if (writeBuffer.length >= BATCH_SIZE) {
    await flushToDatabase();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => {});
      flushTimer = null;
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Get error history with optional filters and pagination.
 */
export async function getErrorHistory(filter = {}) {
  if (isCloud) {
    return { records: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  // Flush pending writes first
  if (writeBuffer.length > 0) await flushToDatabase();

  const db = await getDb();
  let records = [...db.data.records];

  if (filter.connectionId) records = records.filter(r => r.connectionId === filter.connectionId);
  if (filter.provider) records = records.filter(r => r.provider === filter.provider);
  if (filter.statusCode) records = records.filter(r => r.statusCode === Number(filter.statusCode));

  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalItems = records.length;
  const page = Number(filter.page) || 1;
  const pageSize = Number(filter.pageSize) || 20;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paged = records.slice((page - 1) * pageSize, page * pageSize);

  return {
    records: paged,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

/**
 * Clear error history, optionally filtered by connectionId.
 */
export async function clearErrorHistory(connectionId = null) {
  if (isCloud) return;

  // Flush pending writes first
  if (writeBuffer.length > 0) await flushToDatabase();

  const db = await getDb();
  if (connectionId) {
    db.data.records = db.data.records.filter(r => r.connectionId !== connectionId);
  } else {
    db.data.records = [];
  }
  await db.write();
}

// Graceful shutdown
const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
  if (isCloud) return;
  process.off("beforeExit", _shutdownHandler);
  process.off("SIGINT", _shutdownHandler);
  process.off("SIGTERM", _shutdownHandler);
  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
}

ensureShutdownHandler();
