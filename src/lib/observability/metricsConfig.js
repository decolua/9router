// Pure helpers for the OpenTelemetry usage/cost metrics (see metrics.js):
// environment parsing and the /metrics password check. No I/O, no OTel imports, so both are
// unit-tested directly.
import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_SERVICE_NAME = "9router";
const DEFAULT_EXPORT_INTERVAL_MS = 60000;
const DEFAULT_EXPORT_TIMEOUT_MS = 30000;

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

function bool(v) {
  return ["true", "1", "yes", "on"].includes(str(v).toLowerCase());
}

function positiveInt(v, fallback) {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the metrics configuration from an environment object (process.env shape).
 *
 * OTLP push is on when an OTLP endpoint is set (metrics-specific or generic) and
 * OTEL_METRICS_EXPORTER is not "none". Endpoint, headers, protocol details and temporality
 * are left to the OTLP exporter, which reads the standard OTEL_* variables itself.
 */
export function parseMetricsConfig(env = {}) {
  const hasEndpoint = !!(str(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) || str(env.OTEL_EXPORTER_OTLP_ENDPOINT));
  const exporterNone = str(env.OTEL_METRICS_EXPORTER).toLowerCase() === "none";
  const intervalMs = positiveInt(env.OTEL_METRIC_EXPORT_INTERVAL, DEFAULT_EXPORT_INTERVAL_MS);
  // The SDK rejects exportTimeoutMillis > exportIntervalMillis.
  const timeoutMs = Math.min(positiveInt(env.OTEL_METRIC_EXPORT_TIMEOUT, DEFAULT_EXPORT_TIMEOUT_MS), intervalMs);

  const otlp = { enabled: hasEndpoint && !exporterNone, intervalMs, timeoutMs };
  const prometheus = {
    enabled: bool(env.OBSERVABILITY_METRICS_ENDPOINT_ENABLED),
    password: typeof env.OBSERVABILITY_METRICS_ENDPOINT_PASSWORD === "string" ? env.OBSERVABILITY_METRICS_ENDPOINT_PASSWORD : "",
  };

  return {
    enabled: otlp.enabled || prometheus.enabled,
    serviceName: str(env.OTEL_SERVICE_NAME) || DEFAULT_SERVICE_NAME,
    otlp,
    prometheus,
  };
}

// Constant-time compare that does not leak the length either: both sides are hashed first.
function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a), "utf8").digest();
  const hb = createHash("sha256").update(String(b), "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Check an Authorization header against the configured /metrics password.
 * Empty password → open endpoint. Otherwise accepts `Bearer <password>` or HTTP Basic with any
 * username and that password.
 */
export function checkMetricsAuth(authorizationHeader, password) {
  if (!password) return true;
  const header = str(authorizationHeader);
  const space = header.indexOf(" ");
  if (space <= 0) return false;
  const scheme = header.slice(0, space).toLowerCase();
  const value = header.slice(space + 1).trim();

  if (scheme === "bearer") return safeEqual(value, password);

  if (scheme === "basic") {
    if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon === -1) return false;
    return safeEqual(decoded.slice(colon + 1), password);
  }

  return false;
}
