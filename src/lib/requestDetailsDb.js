/**
 * Request details (observability) stored in PostgreSQL.
 * Requires DATABASE_URL. No SQLite dependency.
 */
import { getPool } from "@/lib/db/postgres.js";

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

// ============================================================================
// CONFIGURATION
// ============================================================================

async function getObservabilityConfig() {
  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled =
      typeof settings.observabilityEnabled === "boolean"
        ? settings.observabilityEnabled
        : envEnabled;

    return {
      enabled,
      maxRecords:
        settings.observabilityMaxRecords ||
        parseInt(process.env.OBSERVABILITY_MAX_RECORDS || "1000", 10),
      batchSize:
        settings.observabilityBatchSize ||
        parseInt(process.env.OBSERVABILITY_BATCH_SIZE || "20", 10),
      flushIntervalMs:
        settings.observabilityFlushIntervalMs ||
        parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || "5000", 10),
      maxJsonSize:
        (settings.observabilityMaxJsonSize ||
          parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "1024", 10)) *
        1024,
    };
  } catch (error) {
    console.error("[requestDetailsDb] Failed to load observability config:", error);
    return {
      enabled: true,
      maxRecords: 1000,
      batchSize: 20,
      flushIntervalMs: 5000,
      maxJsonSize: 1024 * 1024,
    };
  }
}

let cachedConfig = null;
let cachedConfigTs = 0;
const CONFIG_CACHE_TTL_MS = 5000;

async function getCachedObservabilityConfig() {
  if (!cachedConfig || Date.now() - cachedConfigTs > CONFIG_CACHE_TTL_MS) {
    cachedConfig = await getObservabilityConfig();
    cachedConfigTs = Date.now();
  }
  return cachedConfig;
}

async function pool() {
  const p = await getPool();
  if (!p) return null;
  return p;
}

// ============================================================================
// BATCH WRITE QUEUE
// ============================================================================

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function safeJsonStringify(obj, maxSize) {
  try {
    const str = JSON.stringify(obj);
    if (str.length > maxSize) {
      return JSON.stringify({
        _truncated: true,
        _originalSize: str.length,
        _preview: str.substring(0, 200),
      });
    }
    return str;
  } catch (error) {
    return JSON.stringify({
      error: "Failed to stringify object",
      message: error.message,
    });
  }
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

async function flushToDatabase() {
  const p = await pool();
  if (!p || isCloud || isFlushing || writeBuffer.length === 0) return;

  isFlushing = true;
  const itemsToSave = [...writeBuffer];
  writeBuffer = [];

  try {
    const config = await getObservabilityConfig();
    const maxJsonSize = config.maxJsonSize;

    const client = await p.connect();
    try {
      await client.query("BEGIN");

      for (const item of itemsToSave) {
        if (!item.id) item.id = generateDetailId(item.model);
        if (!item.timestamp) item.timestamp = new Date().toISOString();
        if (item.request?.headers) {
          item.request.headers = sanitizeHeaders(item.request.headers);
        }

        await client.query(
          `INSERT INTO request_details (
            id, provider, model, connection_id, timestamp, status, latency, tokens,
            request, provider_request, provider_response, response
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            provider = EXCLUDED.provider,
            model = EXCLUDED.model,
            connection_id = EXCLUDED.connection_id,
            timestamp = EXCLUDED.timestamp,
            status = EXCLUDED.status,
            latency = EXCLUDED.latency,
            tokens = EXCLUDED.tokens,
            request = EXCLUDED.request,
            provider_request = EXCLUDED.provider_request,
            provider_response = EXCLUDED.provider_response,
            response = EXCLUDED.response`,
          [
            item.id,
            item.provider || null,
            item.model || null,
            item.connectionId || null,
            new Date(item.timestamp),
            item.status || null,
            JSON.stringify(item.latency || {}),
            JSON.stringify(item.tokens || {}),
            safeJsonStringify(item.request || {}, maxJsonSize),
            safeJsonStringify(item.providerRequest || {}, maxJsonSize),
            safeJsonStringify(item.providerResponse || {}, maxJsonSize),
            safeJsonStringify(item.response || {}, maxJsonSize),
          ]
        );
      }

      await client.query(
        `DELETE FROM request_details
         WHERE id NOT IN (
           SELECT id FROM request_details
           ORDER BY timestamp DESC
           LIMIT $1
         )`,
        [config.maxRecords]
      );

      await client.query("COMMIT");
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[requestDetailsDb] Batch write failed:", error);
  } finally {
    isFlushing = false;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Legacy: returns a no-op db for callers that still use getRequestDetailsDb().
 * Prefer getDistinctRequestDetailProviders() for listing providers.
 */
export async function getRequestDetailsDb() {
  if (isCloud) {
    return {
      prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
      exec: () => {},
      pragma: () => {},
    };
  }
  const p = await pool();
  if (!p) {
    return {
      prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
      exec: () => {},
      pragma: () => {},
    };
  }
  return {
    prepare: (sql) => ({
      run: () => {},
      get: () => null,
      all: () => [],
    }),
    exec: () => {},
    pragma: () => {},
  };
}

/**
 * Returns distinct provider identifiers from request_details (for usage UI).
 * @returns {Promise<string[]>}
 */
export async function getDistinctRequestDetailProviders() {
  const p = await pool();
  if (!p || isCloud) return [];

  const res = await p.query(
    `SELECT DISTINCT provider FROM request_details
     WHERE provider IS NOT NULL AND provider != ''
     ORDER BY provider ASC`
  );
  return (res.rows || []).map((r) => r.provider);
}

export async function saveRequestDetail(detail) {
  if (isCloud) return;

  const p = await pool();
  if (!p) return;

  const config = await getCachedObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  if (writeBuffer.length >= config.batchSize) {
    await flushToDatabase();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => {});
      flushTimer = null;
    }, config.flushIntervalMs);
  }
}

let shutdownHandlerRegistered = false;

function ensureShutdownHandler() {
  if (shutdownHandlerRegistered || isCloud) return;
  const handler = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (writeBuffer.length > 0) {
      console.log(`[requestDetailsDb] Flushing ${writeBuffer.length} items before shutdown...`);
      await flushToDatabase();
    }
  };
  process.on("beforeExit", handler);
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  process.on("exit", handler);
  shutdownHandlerRegistered = true;
}

// Register shutdown on first save (when we have a pool)
async function maybeRegisterShutdown() {
  const p = await pool();
  if (p) ensureShutdownHandler();
}

/**
 * Get request details with filtering and pagination.
 */
export async function getRequestDetails(filter = {}) {
  const p = await pool();
  if (!p || isCloud) {
    return {
      details: [],
      pagination: {
        page: filter.page || 1,
        pageSize: filter.pageSize || 50,
        totalItems: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  const conditions = [];
  const params = [];
  let i = 1;

  if (filter.provider) {
    conditions.push(`provider = $${i++}`);
    params.push(filter.provider);
  }
  if (filter.model) {
    conditions.push(`model = $${i++}`);
    params.push(filter.model);
  }
  if (filter.connectionId) {
    conditions.push(`connection_id = $${i++}`);
    params.push(filter.connectionId);
  }
  if (filter.status) {
    conditions.push(`status = $${i++}`);
    params.push(filter.status);
  }
  if (filter.startDate) {
    conditions.push(`timestamp >= $${i++}`);
    params.push(new Date(filter.startDate));
  }
  if (filter.endDate) {
    conditions.push(`timestamp <= $${i++}`);
    params.push(new Date(filter.endDate));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await p.query(
    `SELECT COUNT(*)::int AS total FROM request_details ${where}`,
    params
  );
  const total = countRes.rows[0]?.total ?? 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  params.push(pageSize, (page - 1) * pageSize);

  const rowsRes = await p.query(
    `SELECT * FROM request_details ${where} ORDER BY timestamp DESC LIMIT $${i} OFFSET $${i + 1}`,
    params
  );
  const rows = rowsRes.rows || [];

  const safeJsonParse = (str, fallback = {}) => {
    try {
      return JSON.parse(str || "{}");
    } catch {
      return fallback;
    }
  };

  /** Normalize tokens so UI always has prompt_tokens and completion_tokens (from input_tokens/output_tokens if needed). */
  function normalizeTokens(tokens) {
    if (!tokens || typeof tokens !== "object") return { prompt_tokens: 0, completion_tokens: 0 };
    return {
      ...tokens,
      prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
      completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0,
    };
  }

  const details = rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: safeJsonParse(row.latency),
    tokens: normalizeTokens(safeJsonParse(row.tokens)),
    request: safeJsonParse(row.request),
    providerRequest: safeJsonParse(row.provider_request),
    providerResponse: safeJsonParse(row.provider_response),
    response: safeJsonParse(row.response),
  }));

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1,
    },
  };
}

/**
 * Get single request detail by ID.
 */
export async function getRequestDetailById(id) {
  const p = await pool();
  if (!p || isCloud) return null;

  const res = await p.query("SELECT * FROM request_details WHERE id = $1", [id]);
  const row = res.rows[0];
  if (!row) return null;

  const safeJsonParse = (str, fallback = {}) => {
    try {
      return JSON.parse(str || "{}");
    } catch {
      return fallback;
    }
  };

  function normalizeTokens(tokens) {
    if (!tokens || typeof tokens !== "object") return { prompt_tokens: 0, completion_tokens: 0 };
    return {
      ...tokens,
      prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
      completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0,
    };
  }

  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: safeJsonParse(row.latency),
    tokens: normalizeTokens(safeJsonParse(row.tokens)),
    request: safeJsonParse(row.request),
    providerRequest: safeJsonParse(row.provider_request),
    providerResponse: safeJsonParse(row.provider_response),
    response: safeJsonParse(row.response),
  };
}

// Register shutdown handler when module is loaded and pool is available
maybeRegisterShutdown().catch(() => {});
