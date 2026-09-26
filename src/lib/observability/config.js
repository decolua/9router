//
// Single source of truth for the observability gates. Before this file there were two
// independent implementations — `requestDetailsRepo.getObservabilityConfig()` (SQLite
// capture) and a module-level `const LOGGING_ENABLED` in `open-sse/utils/requestLogger.js`
// (raw upstream SSE frame capture) — and they drifted: the frame logger could only ever be
// switched on by an env var + redeploy, which is precisely when you cannot use it (during
// an incident). Both gates now resolve from `resolveObservabilityConfig()` below.
//
// ── Precedence ────────────────────────────────────────────────────────────────
// SETTINGS ARE AUTHORITATIVE. The environment only supplies an *initial default* that
// applies while the corresponding key has never been written to the settings row:
//
//   1. stored setting present (key exists in the RAW settings row, right type)  → wins, always
//   2. else environment variable                                                → initial default
//   3. else built-in default (see OBSERVABILITY_DEFAULTS)
//
// "RAW settings row" matters: `settingsRepo.mergeWithDefaults()` fills every key from
// DEFAULT_SETTINGS, so a merged snapshot can never tell "operator chose false" from "never
// set". The old code tested the merged value (`typeof settings.enableObservability ===
// "boolean"`), which is *always* true — that is why the `OBSERVABILITY_ENABLED` fallback
// branch was unreachable dead code. We therefore read the raw row for presence and the
// merged snapshot for values.
//
// The old code also short-circuited on `process.env.ENABLE_REQUEST_LOGS !== undefined`, so
// deploying with `ENABLE_REQUEST_LOGS=false` made the runtime toggle inert. That is gone:
// an env var can no longer override an explicit operator choice.
//
// ── Env vars honoured (all optional, all only as initial defaults) ───────────────────────
//   ENABLE_REQUEST_LOGS            bool  → enableObservability + observabilityFrameLogging
//   OBSERVABILITY_ENABLED          bool  → enableObservability
//   OBSERVABILITY_FRAME_LOGGING    bool  → observabilityFrameLogging
//   OBSERVABILITY_RETENTION_HOURS  int   → observabilityRetentionHours
//   OBSERVABILITY_MAX_LOG_SIZE_MB  int   → observabilityMaxLogSizeMb
//   OBSERVABILITY_MAX_RECORDS / _BATCH_SIZE / _FLUSH_INTERVAL_MS / _MAX_JSON_SIZE (unchanged)

/** Built-in defaults. Mirrors the observability keys in settingsRepo.DEFAULT_SETTINGS. */
export const OBSERVABILITY_DEFAULTS = Object.freeze({
  enableObservability: false,
  // Raw upstream SSE frame capture. Off by default: it is the expensive, high-volume,
  // troubleshooting-only artifact, and it is only meaningful while the master switch is on.
  observabilityFrameLogging: false,
  // Frame logs self-expire so the switch can be left on and forgotten. 12h is long enough
  // to cover an overnight incident, short enough to bound disk use.
  observabilityRetentionHours: 12,
  // Age alone does not bound disk: a burst of large requests (we see ~740 KB of frames for
  // a 240K-token context) can fill a volume long before anything ages out, and the frame
  // logs share the volume with data.sqlite — which holds combos, connections and API keys.
  // A troubleshooting feature must never be able to break the gateway's own config, so a
  // hard size budget applies too. Both caps are enforced; whichever binds first wins.
  observabilityMaxLogSizeMb: 512,
  observabilityMaxRecords: 200,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSizeKb: 5,
});

/** Hard bounds for the retention window (1 hour .. 30 days). */
export const MIN_RETENTION_HOURS = 1;
export const MAX_RETENTION_HOURS = 24 * 30;

/** Hard bounds for the frame-log size budget (1 MiB .. 64 GiB). */
export const MIN_LOG_SIZE_MB = 1;
export const MAX_LOG_SIZE_MB = 64 * 1024;

const CONFIG_CACHE_TTL_MS = 5000;

/** Parse a boolean-ish env value. Returns undefined when unset/blank/unparseable. */
function envBool(env, name) {
  const raw = env?.[name];
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return undefined;
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return undefined;
}

/** Parse a positive-integer env value. Returns undefined when unset/blank/invalid. */
function envInt(env, name) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** First positive finite integer among the candidates, else the last argument. */
function firstPositiveInt(candidates, fallback) {
  for (const c of candidates) {
    const n = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return fallback;
}

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

function hasBool(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === "boolean";
}

/**
 * Pure resolver — no I/O, no cache. This is the function under test.
 *
 * @param {object}  input
 * @param {object} [input.raw]      RAW settings row (unmerged). Presence here = operator chose it.
 * @param {object} [input.settings] Merged settings snapshot (values, e.g. tuning numbers).
 * @param {object} [input.env]      Environment (defaults to `{}`, i.e. no env influence).
 * @returns {{enabled:boolean, frameLogging:boolean, retentionHours:number,
 *            maxRecords:number, batchSize:number, flushIntervalMs:number, maxJsonSize:number}}
 */
export function resolveObservabilityConfig({ raw = {}, settings = {}, env = {} } = {}) {
  // 1. Master switch.
  const enabled = hasBool(raw, "enableObservability")
    ? raw.enableObservability
    : (envBool(env, "ENABLE_REQUEST_LOGS")
      ?? envBool(env, "OBSERVABILITY_ENABLED")
      ?? OBSERVABILITY_DEFAULTS.enableObservability);

  // 2. Raw-frame capture. Independently stored, but gated by the master switch: master off
  //    means frames off, no matter what this says.
  const frameRequested = hasBool(raw, "observabilityFrameLogging")
    ? raw.observabilityFrameLogging
    : (envBool(env, "OBSERVABILITY_FRAME_LOGGING")
      // Upstream compatibility: ENABLE_REQUEST_LOGS=true is what used to switch the file
      // logger on, so it stays the initial default for frames until the setting is written.
      ?? envBool(env, "ENABLE_REQUEST_LOGS")
      ?? OBSERVABILITY_DEFAULTS.observabilityFrameLogging);
  const frameLogging = enabled && frameRequested;

  // 3. Retention for the frame logs.
  const retentionHours = clamp(
    firstPositiveInt(
      [raw?.observabilityRetentionHours,
        envInt(env, "OBSERVABILITY_RETENTION_HOURS"),
        settings?.observabilityRetentionHours],
      OBSERVABILITY_DEFAULTS.observabilityRetentionHours,
    ),
    MIN_RETENTION_HOURS,
    MAX_RETENTION_HOURS,
  );

  // 3b. Size budget for the frame logs. Applies together with the age cap above.
  const maxLogSizeMb = clamp(
    firstPositiveInt(
      [raw?.observabilityMaxLogSizeMb,
        envInt(env, "OBSERVABILITY_MAX_LOG_SIZE_MB"),
        settings?.observabilityMaxLogSizeMb],
      OBSERVABILITY_DEFAULTS.observabilityMaxLogSizeMb,
    ),
    MIN_LOG_SIZE_MB,
    MAX_LOG_SIZE_MB,
  );

  // 4. SQLite-capture tuning knobs — semantics unchanged from upstream.
  const maxRecords = firstPositiveInt(
    [settings?.observabilityMaxRecords, envInt(env, "OBSERVABILITY_MAX_RECORDS")],
    OBSERVABILITY_DEFAULTS.observabilityMaxRecords,
  );
  const batchSize = firstPositiveInt(
    [settings?.observabilityBatchSize, envInt(env, "OBSERVABILITY_BATCH_SIZE")],
    OBSERVABILITY_DEFAULTS.observabilityBatchSize,
  );
  const flushIntervalMs = firstPositiveInt(
    [settings?.observabilityFlushIntervalMs, envInt(env, "OBSERVABILITY_FLUSH_INTERVAL_MS")],
    OBSERVABILITY_DEFAULTS.observabilityFlushIntervalMs,
  );
  const maxJsonSizeKb = firstPositiveInt(
    [settings?.observabilityMaxJsonSize, envInt(env, "OBSERVABILITY_MAX_JSON_SIZE")],
    OBSERVABILITY_DEFAULTS.observabilityMaxJsonSizeKb,
  );

  return {
    enabled,
    frameLogging,
    retentionHours,
    maxLogSizeMb,
    maxLogSizeBytes: maxLogSizeMb * 1024 * 1024,
    maxRecords,
    batchSize,
    flushIntervalMs,
    maxJsonSize: maxJsonSizeKb * 1024,
  };
}

/** Config used when settings cannot be read at all — fail closed (capture nothing). */
export function safeObservabilityConfig() {
  return resolveObservabilityConfig({ raw: {}, settings: {}, env: {} });
}

let cachedConfig = null;
let cachedConfigTs = 0;
let refreshInFlight = null;
// Bumped by invalidate() so a read that started before a PATCH cannot install stale data.
let generation = 0;

/** Drop the cache so a settings PATCH takes effect immediately instead of within the TTL. */
export function invalidateObservabilityConfigCache() {
  cachedConfig = null;
  cachedConfigTs = 0;
  generation += 1;
  refreshInFlight = null;
}

async function readConfig() {
  try {
    const { getSettings, exportSettings } = await import("../db/repos/settingsRepo.js");
    const [settings, raw] = await Promise.all([getSettings(), exportSettings()]);
    return resolveObservabilityConfig({ raw, settings, env: process.env });
  } catch {
    // Settings unreadable → fail closed rather than start capturing by accident.
    return safeObservabilityConfig();
  }
}

function refresh() {
  if (refreshInFlight) return refreshInFlight;
  const gen = generation;
  const p = readConfig().then((cfg) => {
    if (gen === generation) {
      cachedConfig = cfg;
      cachedConfigTs = Date.now();
    }
    if (refreshInFlight === p) refreshInFlight = null;
    return cfg;
  });
  refreshInFlight = p;
  return p;
}

/**
 * Cached runtime resolve. Safe to call on every request: it awaits a settings read only on
 * the very first call (and right after an invalidate); afterwards it serves the cached value
 * and refreshes in the background once the 5s TTL lapses, so the request path never blocks
 * on the DB. Never throws — an unreadable settings row fails closed.
 */
export async function getObservabilityConfig() {
  if (!cachedConfig) return refresh();
  if (Date.now() - cachedConfigTs >= CONFIG_CACHE_TTL_MS) {
    // Stale-while-revalidate: kick the read off, hand back the last known value.
    refresh().catch(() => {});
  }
  return cachedConfig;
}

export const __test__ = { envBool, envInt, firstPositiveInt };
