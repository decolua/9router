// Per-API-key usage and cost metrics via the OpenTelemetry metrics SDK (no tracing, no
// auto-instrumentation, no NodeSDK, so it coexists with APM agents such as `-r newrelic`).
//
//   ninerouter.requests  counter            one per request
//   ninerouter.tokens    counter            attribute type = prompt|completion|cached|reasoning|cache_creation
//   ninerouter.cost.usd  counter (float)    unit USD, from the same calculateCost() the dashboard uses
//                                           (Prometheus: ninerouter_cost_usd_total)
//
// Common attributes: key_name, model, provider, endpoint, status. key_name is the API key's
// NAME ("no-key" without a key, "unknown-key" when the presented key is not in the DB). The
// key value is never used as an attribute.
//
// Two readers, both optional, both env-driven (parseMetricsConfig):
//   - OTLP push (http/protobuf) when an OTEL_EXPORTER_OTLP_*ENDPOINT is set; the exporter reads
//     the standard OTEL_* variables itself (headers, temporality preference).
//   - Prometheus pull at GET /metrics (src/app/metrics/route.js), cumulative, with the
//     exporter's own HTTP server disabled.
// With neither configured nothing is created and every call below is a cheap no-op.
//
// Next.js may load this module in several bundles, so the provider and instruments live in a
// globalThis singleton, created lazily on first use. Every public function swallows errors:
// metrics must never break a request.
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PrometheusExporter, PrometheusSerializer } from "@opentelemetry/exporter-prometheus";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getApiKeyByKey } from "../db/repos/apiKeysRepo.js";
import { parseMetricsConfig } from "./metricsConfig.js";

const GLOBAL_KEY = "__ninerouterMetrics";
const METER_NAME = "9router";

export const KEY_NAME_NONE = "no-key";
export const KEY_NAME_UNKNOWN = "unknown-key";

// Values of the `status` attribute.
export const METRIC_STATUS = Object.freeze({
  OK: "ok",             // persisted usage row (saveRequestUsage); entry.status overrides
  EMPTY: "empty",       // usage reported zero input and output tokens (not persisted)
  NO_USAGE: "no_usage", // no usage object at all (not persisted)
  ERROR: "error",       // provider returned non-2xx, or the upstream call threw
  ABORTED: "aborted",   // client went away (499)
});

// token field on the canonical usage object → `type` attribute value
const TOKEN_TYPES = [
  ["prompt_tokens", "prompt"],
  ["completion_tokens", "completion"],
  ["cached_tokens", "cached"],
  ["reasoning_tokens", "reasoning"],
  ["cache_creation_input_tokens", "cache_creation"],
];

function holder() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = { state: undefined, pending: new Set() };
  return globalThis[GLOBAL_KEY];
}

function createState(config) {
  const readers = [];
  let prometheusExporter = null;

  if (config.prometheus.enabled) {
    prometheusExporter = new PrometheusExporter({ preventServerStart: true });
    readers.push(prometheusExporter);
  }
  if (config.otlp.enabled) {
    readers.push(new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: config.otlp.intervalMs,
      exportTimeoutMillis: config.otlp.timeoutMs,
    }));
  }

  const provider = new MeterProvider({
    resource: resourceFromAttributes({ "service.name": config.serviceName }),
    readers,
  });
  const meter = provider.getMeter(METER_NAME);

  return {
    config,
    provider,
    prometheusExporter,
    serializer: prometheusExporter ? new PrometheusSerializer() : null,
    requests: meter.createCounter("ninerouter.requests", { description: "Requests seen by 9router, per API key name" }),
    tokens: meter.createCounter("ninerouter.tokens", { description: "Tokens per API key name, by type" }),
    cost: meter.createCounter("ninerouter.cost.usd", { description: "Estimated cost per API key name", unit: "USD" }),
  };
}

/** The live metrics state, or null when metrics are not configured (or failed to start). */
export function getMetrics() {
  const h = holder();
  if (h.state === undefined) {
    try {
      const config = parseMetricsConfig(process.env);
      h.state = config.enabled ? createState(config) : null;
    } catch (e) {
      console.error("[metrics] failed to initialise, metrics disabled:", e?.message || e);
      h.state = null;
    }
  }
  return h.state;
}

/** Start the readers early (OTLP push begins without waiting for the first request). */
export function initMetrics() {
  try { getMetrics(); } catch { /* never throws */ }
}

async function resolveKeyName(apiKey) {
  if (!apiKey) return KEY_NAME_NONE;
  try {
    const key = await getApiKeyByKey(apiKey);
    return key?.name || KEY_NAME_UNKNOWN;
  } catch {
    return KEY_NAME_UNKNOWN;
  }
}

function endpointLabel(endpoint) {
  if (!endpoint || typeof endpoint !== "string") return "unknown";
  const q = endpoint.indexOf("?");
  return q === -1 ? endpoint : endpoint.slice(0, q);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function baseAttributes({ apiKey, model, provider, endpoint, status }) {
  return {
    key_name: await resolveKeyName(apiKey),
    model: model || "unknown",
    provider: provider || "unknown",
    endpoint: endpointLabel(endpoint),
    status: status || METRIC_STATUS.OK,
  };
}

/**
 * Record one persisted usage entry (called by saveRequestUsage after a successful insert,
 * so `entry.cost` is already computed). Never throws.
 */
export async function recordRequestMetrics(entry) {
  try {
    const m = getMetrics();
    if (!m || !entry) return;
    const attrs = await baseAttributes(entry);
    m.requests.add(1, attrs);
    const t = entry.tokens || {};
    for (const [field, type] of TOKEN_TYPES) {
      const n = num(t[field]);
      if (n) m.tokens.add(n, { ...attrs, type });
    }
    const cost = num(entry.cost);
    if (cost) m.cost.add(cost, attrs);
  } catch {
    // metrics must never break a request
  }
}

/**
 * Count a request that upstream does NOT persist (saveUsageStats returns early when there is
 * no usage object, or when it reports zero in/out tokens). Requests with tokens are left to
 * saveRequestUsage → recordRequestMetrics. Fire-and-forget, never throws.
 */
export function recordUnsavedRequestMetrics({ provider, model, tokens, apiKey, endpoint } = {}) {
  try {
    if (!getMetrics()) return;
    let status;
    if (!tokens || typeof tokens !== "object") {
      status = METRIC_STATUS.NO_USAGE;
    } else {
      const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
      const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;
      if (inTokens !== 0 || outTokens !== 0) return;
      status = METRIC_STATUS.EMPTY;
    }
    countRequestOnly({ apiKey, model, provider, endpoint, status });
  } catch {
    // ignore
  }
}

/**
 * Count a request the provider failed (non-2xx response, or the upstream call threw) —
 * these never reach saveUsageStats. status = "aborted" for 499 (client went away), else
 * "error". Zero tokens, no cost. Fire-and-forget, never throws.
 */
export function recordFailedRequestMetrics({ provider, model, apiKey, endpoint, statusCode } = {}) {
  try {
    if (!getMetrics()) return;
    const status = Number(statusCode) === HTTP_STATUS.CLIENT_CLOSED_REQUEST ? METRIC_STATUS.ABORTED : METRIC_STATUS.ERROR;
    countRequestOnly({ apiKey, model, provider, endpoint, status });
  } catch {
    // ignore
  }
}

// Add 1 to ninerouter.requests asynchronously (the key-name lookup is async), tracked so
// tests can flush it.
function countRequestOnly(fields) {
  const { pending } = holder();
  const p = (async () => {
    try {
      const m = getMetrics();
      if (!m) return;
      m.requests.add(1, await baseAttributes(fields));
    } catch { /* ignore */ }
  })();
  pending.add(p);
  p.finally(() => pending.delete(p));
}

/** Collect the current cumulative metrics in Prometheus text format, or null when disabled. */
export async function collectPrometheusText() {
  const m = getMetrics();
  if (!m || !m.prometheusExporter) return null;
  const { resourceMetrics } = await m.prometheusExporter.collect();
  return m.serializer.serialize(resourceMetrics);
}

export async function __flushPendingForTests() {
  await Promise.all([...holder().pending]);
}

export async function __resetMetricsForTests() {
  const h = holder();
  await Promise.all([...h.pending]);
  if (h.state) {
    try { await h.state.provider.shutdown(); } catch { /* ignore */ }
  }
  h.state = undefined;
}
