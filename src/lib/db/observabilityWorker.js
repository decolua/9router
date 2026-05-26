import { parentPort } from "worker_threads";
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

// === Helpers cho Bảng requestDetails ===
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = [
    "authorization",
    "x-api-key",
    "cookie",
    "token",
    "api-key",
  ];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s)))
      delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return {
      _truncated: true,
      _originalSize: str.length,
      _preview: str.substring(0, 200),
    };
  }
  return obj || {};
}

// === Helpers cho Bảng usageHistory & usageDaily ===
function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key])
    target[key] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
    };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens =
    entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens =
    entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider
    ? `${entry.model}|${entry.provider}`
    : entry.model;
  addToCounter(day.byModel, modelKey, {
    ...vals,
    meta: { rawModel: entry.model, provider: entry.provider },
  });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, {
      ...vals,
      meta: { rawModel: entry.model, provider: entry.provider },
    });
  }

  const apiKeyVal =
    entry.apiKey && typeof entry.apiKey === "string"
      ? entry.apiKey
      : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, {
    ...vals,
    meta: {
      rawModel: entry.model,
      provider: entry.provider,
      apiKey: entry.apiKey || null,
    },
  });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, {
    ...vals,
    meta: { endpoint, rawModel: entry.model, provider: entry.provider },
  });
}

let db = null;

async function initDb() {
  if (!db) {
    db = await getAdapter();
  }
  return db;
}

parentPort.on("message", async (message) => {
  const { type, payload } = message;

  try {
    const database = await initDb();
    if (!database) {
      console.error("[observabilityWorker] Database not initialized");
      return;
    }

    if (type === "write_details") {
      const { items, maxRecords, maxJsonSize } = payload;

      database.transaction(() => {
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(item.model);
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers)
            item.request.headers = sanitizeHeaders(item.request.headers);

          const record = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, maxJsonSize),
            providerRequest: truncateField(item.providerRequest, maxJsonSize),
            providerResponse: truncateField(item.providerResponse, maxJsonSize),
            response: truncateField(item.response, maxJsonSize),
          };

          database.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) 
             VALUES(?, ?, ?, ?, ?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET 
               timestamp = excluded.timestamp, 
               provider = excluded.provider, 
               model = excluded.model, 
               connectionId = excluded.connectionId, 
               status = excluded.status, 
               data = excluded.data`,
            [
              record.id,
              record.timestamp,
              record.provider,
              record.model,
              record.connectionId,
              record.status,
              stringifyJson(record),
            ],
          );
        }

        const cnt = database.get(`SELECT COUNT(*) as c FROM requestDetails`);
        if (cnt && cnt.c > maxRecords) {
          database.run(
            `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
            [cnt.c - maxRecords],
          );
        }
      });
    }

    if (type === "write_usage") {
      const { entry } = payload;

      const tokens = entry.tokens || {};
      const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
      const completionTokens =
        tokens.completion_tokens || tokens.output_tokens || 0;

      database.transaction(() => {
        // 1. Ghi usageHistory
        database.run(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) 
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.timestamp,
            entry.provider || null,
            entry.model || null,
            entry.connectionId || null,
            entry.apiKey || null,
            entry.endpoint || null,
            promptTokens,
            completionTokens,
            entry.cost || 0,
            entry.status || "ok",
            stringifyJson(tokens),
            stringifyJson({}),
          ],
        );

        // 2. Ghi usageDaily
        const dateKey = getLocalDateKey(entry.timestamp);
        const row = database.get(
          `SELECT data FROM usageDaily WHERE dateKey = ?`,
          [dateKey],
        );
        const day = row
          ? parseJson(row.data, {})
          : {
              requests: 0,
              promptTokens: 0,
              completionTokens: 0,
              cost: 0,
              byProvider: {},
              byModel: {},
              byAccount: {},
              byApiKey: {},
              byEndpoint: {},
            };
        aggregateEntryToDay(day, entry);
        database.run(
          `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) 
           ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
          [dateKey, stringifyJson(day)],
        );

        // 3. Tăng bộ đếm _meta
        const cur = database.get(
          `SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`,
        );
        const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
        database.run(
          `INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) 
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [String(next)],
        );
      });
    }
  } catch (error) {
    console.error(
      `[observabilityWorker] Error executing task "${type}":`,
      error,
    );
  }
});
