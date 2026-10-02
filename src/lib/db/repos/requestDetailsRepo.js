import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 5000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 1500;
const DEFAULT_MAX_JSON_SIZE = 256 * 1024;
const CONFIG_CACHE_TTL_MS = 3000;

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
        maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "256", 10)) * 1024,
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const enabled = uiFlag
      ? settings.enableObservability
      : (envFallback !== false);

    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "256", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: true,
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
let activeFlushPromise = null;

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
  if (!obj || typeof obj !== "object") return obj || {};
  const str = JSON.stringify(obj);
  if (str.length <= maxSize) return obj;

  // Preserve messages array for UI display if possible
  if (Array.isArray(obj.messages)) {
    const truncatedMessages = obj.messages.map((m) => {
      if (typeof m.content === "string" && m.content.length > 4000) {
        return { ...m, content: m.content.slice(0, 4000) + "\n...[truncated]" };
      }
      return m;
    });
    const candidate = { ...obj, messages: truncatedMessages, _truncated: true };
    if (JSON.stringify(candidate).length <= maxSize) {
      return candidate;
    }
  }

  // Preserve response text if possible
  if (typeof obj.content === "string") {
    return {
      ...obj,
      content: obj.content.slice(0, 4000) + "\n...[truncated]",
      _truncated: true,
      _originalSize: str.length,
    };
  }

  return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 300) };
}

async function flushToDatabase() {
  if (activeFlushPromise) return activeFlushPromise;
  if (writeBuffer.length === 0) return Promise.resolve();

  activeFlushPromise = (async () => {
    try {
      // Drain entire buffer
      while (writeBuffer.length > 0) {
        const items = writeBuffer.splice(0, writeBuffer.length);
        const db = await getAdapter();
        const config = await getObservabilityConfig();

        for (const item of items) {
          if ((typeof item.cost !== "number" || item.cost === 0) && item.provider && item.model) {
            const pTokens = item.tokens?.prompt_tokens ?? item.tokens?.input_tokens ?? 0;
            const cTokens = item.tokens?.completion_tokens ?? item.tokens?.output_tokens ?? 0;
            if (pTokens > 0 || cTokens > 0) {
              try {
                const { getPricingForModel } = await import("./pricingRepo.js");
                const pricing = await getPricingForModel(item.provider, item.model);
                if (pricing) {
                  const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
                  item.cost = calculateCostFromTokens({ prompt_tokens: pTokens, completion_tokens: cTokens }, pricing) || 0;
                }
              } catch {}
            }
          }
        }

        db.transaction(() => {
          for (const item of items) {
            if (!item.id) item.id = generateDetailId(item.model);
            if (!item.timestamp) item.timestamp = new Date().toISOString();
            if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

            const promptTokens = item.tokens?.prompt_tokens ?? item.tokens?.input_tokens ?? 0;
            const completionTokens = item.tokens?.completion_tokens ?? item.tokens?.output_tokens ?? 0;
            const totalTokens = item.tokens?.total_tokens ?? (promptTokens + completionTokens);

            const tokensObj = {
              ...item.tokens,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
            };

            const itemCost = typeof item.cost === "number" ? item.cost : 0;

            const record = {
              id: item.id,
              provider: item.provider || null,
              model: item.model || null,
              connectionId: item.connectionId || null,
              apiKey: item.apiKey || null,
              customer: item.customer || null,
              ip: item.ip || null,
              timestamp: item.timestamp,
              status: item.status || "success",
              error: item.error || null,
              cost: itemCost,
              latency: item.latency || {},
              tokens: tokensObj,
              request: truncateField(item.request, config.maxJsonSize),
              providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
              providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
              response: truncateField(item.response, config.maxJsonSize),
              pxpipe: item.pxpipe || undefined,
            };

            db.run(
              `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, apiKey, ip, status, data)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 timestamp = excluded.timestamp,
                 provider = excluded.provider,
                 model = excluded.model,
                 connectionId = excluded.connectionId,
                 apiKey = excluded.apiKey,
                 ip = excluded.ip,
                 status = excluded.status,
                 data = excluded.data`,
              [
                record.id,
                record.timestamp,
                record.provider,
                record.model,
                record.connectionId,
                record.apiKey,
                record.ip,
                record.status,
                stringifyJson(record),
              ]
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
      activeFlushPromise = null;
    }
  })();

  return activeFlushPromise;
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

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

export async function flushRequestDetailsNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (activeFlushPromise) {
    await activeFlushPromise;
  }
  if (writeBuffer.length > 0) {
    await flushToDatabase();
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) {
    conds.push("provider = ?");
    params.push(filter.provider);
  }

  if (filter.model) {
    conds.push("(model = ? OR model LIKE ?)");
    params.push(filter.model, `%${filter.model}%`);
  }

  if (filter.connectionId) {
    conds.push("connectionId = ?");
    params.push(filter.connectionId);
  }

  if (filter.apiKey) {
    conds.push("(apiKey = ? OR apiKey LIKE ? OR json_extract(data, '$.customer') LIKE ?)");
    params.push(filter.apiKey, `%${filter.apiKey}%`, `%${filter.apiKey}%`);
  }

  if (filter.customer) {
    conds.push("(json_extract(data, '$.customer') LIKE ? OR apiKey LIKE ?)");
    params.push(`%${filter.customer}%`, `%${filter.customer}%`);
  }

  if (filter.status) {
    conds.push("status = ?");
    params.push(filter.status);
  }

  if (filter.ip) {
    conds.push("ip = ?");
    params.push(filter.ip);
  }

  if (filter.startDate) {
    conds.push("timestamp >= ?");
    params.push(new Date(filter.startDate).toISOString());
  }

  if (filter.endDate) {
    conds.push("timestamp <= ?");
    params.push(new Date(filter.endDate).toISOString());
  }

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

export async function getDistinctModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT model FROM requestDetails WHERE model IS NOT NULL ORDER BY model ASC`);
  return rows.map((r) => r.model);
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
