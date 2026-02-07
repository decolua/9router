import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

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

// Singleton instance
let dbInstance = null;

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
 * Save request detail to SQLite
 * @param {object} detail - Request detail object
 */
export async function saveRequestDetail(detail) {
  if (isCloud) return;

  try {
    const db = await getRequestDetailsDb();

    if (!detail.id) {
      detail.id = generateDetailId(detail.model);
    }

    if (!detail.timestamp) {
      detail.timestamp = new Date().toISOString();
    }

    // Sanitize headers if present
    if (detail.request && detail.request.headers) {
      detail.request.headers = sanitizeHeaders(detail.request.headers);
    }

    const stmt = db.prepare(`
      INSERT INTO request_details
      (id, provider, model, connection_id, timestamp, status, latency, tokens,
       request, provider_request, provider_response, response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      detail.id,
      detail.provider || null,
      detail.model || null,
      detail.connectionId || null,
      new Date(detail.timestamp).getTime(),
      detail.status || null,
      JSON.stringify(detail.latency || {}),
      JSON.stringify(detail.tokens || {}),
      JSON.stringify(detail.request || {}),
      JSON.stringify(detail.providerRequest || {}),
      JSON.stringify(detail.providerResponse || {}),
      JSON.stringify(detail.response || {})
    );

    // Keep only the latest 1000 records
    db.prepare(`
      DELETE FROM request_details
      WHERE id NOT IN (
        SELECT id FROM request_details
        ORDER BY timestamp DESC
        LIMIT 1000
      )
    `).run();

  } catch (error) {
    console.error("[requestDetailsDb] Failed to save request detail:", error);
  }
}

/**
 * Get request details with filtering and pagination
 * @param {object} filter - Filter options
 * @returns {Promise<object>} Details with pagination info
 */
export async function getRequestDetails(filter = {}) {
  const db = await getRequestDetailsDb();

  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: filter.pageSize || 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
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
      total,
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
