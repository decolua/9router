import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

// ============================================================================
// CONFIGURATION: Batch Processing Settings
// ============================================================================

/**
 * Get observability configuration from settings.
 * Falls back to environment variables, then defaults.
 */
async function getObservabilityConfig() {
  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();

    return {
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || '1000', 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || '20', 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || '5000', 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || '1024', 10)) * 1024
    };
  } catch (error) {
    console.error("[requestDetailsDb] Failed to load observability config:", error);
    return {
      maxRecords: 1000,
      batchSize: 20,
      flushIntervalMs: 5000,
      maxJsonSize: 1024 * 1024
    };
  }
}

// Cache config to avoid repeated database reads
let cachedConfig = null;

let dbInstance = null;

// Get app name
function getAppName() {
  return "9router";
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp";

  try {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appName = getAppName();

    if (platform === "win32") {
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
    } else {
      return path.join(homeDir, `.${appName}`);
    }
  } catch (error) {
    console.error("[requestDetailsDb] Failed to get user data directory:", error.message);
    return path.join(process.cwd(), ".9router");
  }
}

// Database file path
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "request-details.sqlite");

// Ensure data directory exists
if (!isCloud && fs && typeof fs.existsSync === "function") {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.error("[requestDetailsDb] Failed to create data directory:", error.message);
  }
}

// ============================================================================
// BATCH WRITE QUEUE
// ============================================================================

/**
 * In-memory buffer for batch writes.
 * Accumulates request details before flushing to database in a transaction.
 * @type {Array<object>}
 */
let writeBuffer = [];

/**
 * Timer reference for auto-flush mechanism.
 * Ensures data is written even during low traffic periods.
 * @type {NodeJS.Timeout|null}
 */
let flushTimer = null;

/**
 * Flag indicating if a flush operation is currently in progress.
 * Prevents concurrent flushes.
 * @type {boolean}
 */
let isFlushing = false;

/**
 * Get SQLite database instance (singleton)
 */
export async function getRequestDetailsDb() {
  if (isCloud) {
    // In-memory mock for Workers
    if (!dbInstance) {
      dbInstance = {
        prepare: () => ({
          run: () => {},
          get: () => null,
          all: () => []
        }),
        exec: () => {},
        pragma: () => {}
      };
    }
    return dbInstance;
  }

  if (!dbInstance) {
    const db = new Database(DB_FILE);

    // Configure for better concurrency
    db.pragma('journal_mode = WAL');        // Write-Ahead Logging for concurrent access
    db.pragma('synchronous = NORMAL');       // Faster than FULL, still safe
    db.pragma('cache_size = -64000');        // 64MB cache
    db.pragma('temp_store = MEMORY');        // Use memory for temp tables

    // Create table with indexes
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_details (
        id TEXT PRIMARY KEY,
        provider TEXT,
        model TEXT,
        connection_id TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT,
        latency TEXT,
        tokens TEXT,
        request TEXT,
        provider_request TEXT,
        provider_response TEXT,
        response TEXT
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_timestamp
        ON request_details(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_provider
        ON request_details(provider);
      CREATE INDEX IF NOT EXISTS idx_model
        ON request_details(model);
      CREATE INDEX IF NOT EXISTS idx_connection
        ON request_details(connection_id);
      CREATE INDEX IF NOT EXISTS idx_status
        ON request_details(status);
    `);

    dbInstance = db;

    // Register shutdown handler on first database initialization
    ensureShutdownHandler();
  }

  return dbInstance;
}

/**
 * Generate unique ID for request detail
 */
function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, '-') : 'unknown';
  return `${timestamp}-${random}-${modelPart}`;
}

/**
 * Flush all buffered items to database in a single transaction.
 * This function is called automatically when:
 * 1. Buffer size reaches OBSERVABILITY_BATCH_SIZE
 * 2. OBSERVABILITY_FLUSH_INTERVAL_MS elapses
 * 3. Process is shutting down (graceful shutdown)
 *
 * @private
 */
async function flushToDatabase() {
  if (isCloud || isFlushing || writeBuffer.length === 0) {
    return;
  }

  isFlushing = true;

  try {
    // Take a snapshot of the buffer and clear it immediately
    const itemsToSave = [...writeBuffer];
    writeBuffer = [];

    const db = await getRequestDetailsDb();
    const config = await getObservabilityConfig();

    // Prepare statements outside transaction for better performance
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO request_details
      (id, provider, model, connection_id, timestamp, status, latency, tokens,
       request, provider_request, provider_response, response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteStmt = db.prepare(`
      DELETE FROM request_details
      WHERE id NOT IN (
        SELECT id FROM request_details
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `);

    // Execute all writes in a single transaction for atomicity
    const transaction = db.transaction((items) => {
      const maxJsonSize = config.maxJsonSize;

      for (const item of items) {
        if (!item.id) {
          item.id = generateDetailId(item.model);
        }

        if (!item.timestamp) {
          item.timestamp = new Date().toISOString();
        }

        // Sanitize headers if present
        if (item.request && item.request.headers) {
          item.request.headers = sanitizeHeaders(item.request.headers);
        }

        insertStmt.run(
          item.id,
          item.provider || null,
          item.model || null,
          item.connectionId || null,
          new Date(item.timestamp).getTime(),
          item.status || null,
          JSON.stringify(item.latency || {}),
          JSON.stringify(item.tokens || {}),
          safeJsonStringify(item.request || {}, maxJsonSize),
          safeJsonStringify(item.providerRequest || {}, maxJsonSize),
          safeJsonStringify(item.providerResponse || {}, maxJsonSize),
          safeJsonStringify(item.response || {}, maxJsonSize)
        );
      }

      // Cleanup old records once per batch (not per item)
      deleteStmt.run(config.maxRecords);
    });

    transaction(itemsToSave);
  } catch (error) {
    console.error("[requestDetailsDb] Batch write failed:", error);
  } finally {
    isFlushing = false;
  }
}

/**
 * Safely stringify an object with a size limit.
 * Truncates the result if it exceeds the limit.
 * @param {object} obj - Object to stringify
 * @param {number} maxSize - Maximum string size in bytes
 * @returns {string}
 */
function safeJsonStringify(obj, maxSize) {
  try {
    const str = JSON.stringify(obj);
    if (str.length > maxSize) {
      return str.substring(0, maxSize) + "... (truncated due to size limit)";
    }
    return str;
  } catch (error) {
    return JSON.stringify({ error: "Failed to stringify object", message: error.message });
  }
}

/**
 * Sanitize sensitive headers from request
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};

  const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'token', 'api-key'];
  const sanitized = { ...headers };

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

/**
 * Save request detail to SQLite (batched for performance).
 * Details are accumulated in memory and flushed to database in batches.
 *
 * @param {object} detail - Request detail object
 * @see {@link flushToDatabase} for batch write implementation
 */
export async function saveRequestDetail(detail) {
  if (isCloud) return;

  if (!cachedConfig) {
    cachedConfig = await getObservabilityConfig();
  }

  writeBuffer.push(detail);

  if (writeBuffer.length >= cachedConfig.batchSize) {
    await flushToDatabase();

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => {});
      flushTimer = null;
    }, cachedConfig.flushIntervalMs);
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN HANDLER
// ============================================================================

let shutdownHandlerRegistered = false;

/**
 * Register process shutdown handlers to flush remaining data before exit.
 * Should be called once when the module initializes.
 */
function ensureShutdownHandler() {
  if (shutdownHandlerRegistered || isCloud) {
    return;
  }

  const handler = async () => {
    // Clear timer to prevent any pending flush
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    // Flush any remaining data in buffer
    if (writeBuffer.length > 0) {
      console.log(`[requestDetailsDb] Flushing ${writeBuffer.length} items before shutdown...`);
      await flushToDatabase();
    }
  };

  // Register handlers for various termination signals
  process.on('beforeExit', handler);
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  process.on('exit', handler);

  shutdownHandlerRegistered = true;
}

/**
 * Get request details with filtering and pagination
 * @param {object} filter - Filter options
 * @returns {Promise<object>} Details with pagination info
 */
export async function getRequestDetails(filter = {}) {
  const db = await getRequestDetailsDb();

  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: filter.pageSize || 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  let query = 'SELECT * FROM request_details WHERE 1=1';
  const params = [];

  if (filter.provider) {
    query += ' AND provider = ?';
    params.push(filter.provider);
  }

  if (filter.model) {
    query += ' AND model = ?';
    params.push(filter.model);
  }

  if (filter.connectionId) {
    query += ' AND connection_id = ?';
    params.push(filter.connectionId);
  }

  if (filter.status) {
    query += ' AND status = ?';
    params.push(filter.status);
  }

  if (filter.startDate) {
    query += ' AND timestamp >= ?';
    params.push(new Date(filter.startDate).getTime());
  }

  if (filter.endDate) {
    query += ' AND timestamp <= ?';
    params.push(new Date(filter.endDate).getTime());
  }

  // Get total count first
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
  const countStmt = db.prepare(countQuery);
  const totalResult = countStmt.get(...params);
  const total = totalResult['COUNT(*)'];

  // Add pagination
  query += ' ORDER BY timestamp DESC';
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  query += ' LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  // Execute query
  const stmt = db.prepare(query);
  const rows = stmt.all(...params);

  // Convert back to original format
  const details = rows.map(row => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: JSON.parse(row.latency || '{}'),
    tokens: JSON.parse(row.tokens || '{}'),
    request: JSON.parse(row.request || '{}'),
    providerRequest: JSON.parse(row.provider_request || '{}'),
    providerResponse: JSON.parse(row.provider_response || '{}'),
    response: JSON.parse(row.response || '{}')
  }));

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1
    }
  };
}

/**
 * Get single request detail by ID
 * @param {string} id - Request detail ID
 * @returns {Promise<object|null>} Request detail or null
 */
export async function getRequestDetailById(id) {
  const db = await getRequestDetailsDb();

  if (isCloud) return null;

  const stmt = db.prepare('SELECT * FROM request_details WHERE id = ?');
  const row = stmt.get(id);

  if (!row) return null;

  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: JSON.parse(row.latency || '{}'),
    tokens: JSON.parse(row.tokens || '{}'),
    request: JSON.parse(row.request || '{}'),
    providerRequest: JSON.parse(row.provider_request || '{}'),
    providerResponse: JSON.parse(row.provider_response || '{}'),
    response: JSON.parse(row.response || '{}')
  };
}
