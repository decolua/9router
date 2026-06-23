import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

type ObservabilityConfig = {
  enabled: boolean;
  maxRecords: number;
  batchSize: number;
  flushIntervalMs: number;
  maxJsonSize: number;
};

let cachedConfig: ObservabilityConfig | null = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    // Dynamic import: settingsRepo would form a circular dep if imported statically here
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envEnabled = process.env["OBSERVABILITY_ENABLED"] !== "false";
    const enabled = typeof settings.enableObservability2 === "boolean"
      ? settings.enableObservability2
      : envEnabled;
    cachedConfig = {
      enabled: enabled as boolean,
      maxRecords: (settings.observabilityMaxRecords as number) || parseInt(process.env["OBSERVABILITY_MAX_RECORDS"] ?? String(DEFAULT_MAX_RECORDS), 10),
      batchSize: (settings.observabilityBatchSize as number) || parseInt(process.env["OBSERVABILITY_BATCH_SIZE"] ?? String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: (settings.observabilityFlushIntervalMs as number) || parseInt(process.env["OBSERVABILITY_FLUSH_INTERVAL_MS"] ?? String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: ((settings.observabilityMaxJsonSize as number) || parseInt(process.env["OBSERVABILITY_MAX_JSON_SIZE"] ?? "5", 10)) * 1024,
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

let writeBuffer: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

function sanitizeHeaders(headers: unknown): Record<string, unknown> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...(headers as Record<string, unknown>) };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model: string | null | undefined) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj: unknown, maxSize: number): Record<string, unknown> {
  const str = JSON.stringify(obj ?? {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return (obj as Record<string, unknown>) ?? {};
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();

      db.transaction(() => {
        for (const item of items) {
          if (!item["id"]) item["id"] = generateDetailId(item["model"] as string | null);
          if (!item["timestamp"]) item["timestamp"] = new Date().toISOString();
          if (item["request"] && typeof item["request"] === "object") {
            const req = item["request"] as Record<string, unknown>;
            if (req["headers"]) req["headers"] = sanitizeHeaders(req["headers"]);
          }

          const record = {
            id: item["id"],
            provider: item["provider"] ?? null,
            model: item["model"] ?? null,
            connectionId: item["connectionId"] ?? null,
            timestamp: item["timestamp"],
            status: item["status"] ?? null,
            latency: item["latency"] ?? {},
            tokens: item["tokens"] ?? {},
            request: truncateField(item["request"], config.maxJsonSize),
            providerRequest: truncateField(item["providerRequest"], config.maxJsonSize),
            providerResponse: truncateField(item["providerResponse"], config.maxJsonSize),
            response: truncateField(item["response"], config.maxJsonSize),
          };

          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record as unknown as JsonValue)]
          );
        }

        const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`) as { c: number } | undefined;
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

export async function saveRequestDetail(detail: Record<string, unknown>) {
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

export async function getRequestDetails(filter: {
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const db = await getAdapter();
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params) as { c: number } | undefined;
  const totalItems = cntRow?.c ?? 0;

  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  ) as Record<string, unknown>[];
  const details = rows.map((r) => parseJson(r["data"] as string | null, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id: string) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
  return row ? parseJson(row["data"] as string | null, null) : null;
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
