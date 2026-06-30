// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Inter-chunk stall timeout (once tokens are flowing). Kiro extended-thinking
// and large file writes can pause output for 60-120s, so a short timeout caused
// false "stall" aborts mid-conversation. Generous headroom. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration.
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);
// Claude-compatible proxy pools can legitimately take longer to return headers,
// especially when routing to overloaded free/pooled backends.
export const ANTHROPIC_COMPATIBLE_FETCH_CONNECT_TIMEOUT_MS = 90 * 1000;
export const FETCH_CONNECT_TIMEOUT_MAX_MS = 10 * 60 * 1000;

export function resolveFetchConnectTimeoutMs(provider, config = {}, credentials = null) {
  const raw = credentials?.providerSpecificData?.fetchConnectTimeoutMs
    ?? config?.fetchConnectTimeoutMs;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 1000), FETCH_CONNECT_TIMEOUT_MAX_MS);
  }
  if (provider?.startsWith?.("anthropic-compatible-")) {
    return ANTHROPIC_COMPATIBLE_FETCH_CONNECT_TIMEOUT_MS;
  }
  return FETCH_CONNECT_TIMEOUT_MS;
}

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);
// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

// Default aggressive 429-contention config (used by Kiro). Overridable per
// provider via PROVIDERS[x].kiroRateLimit.
export const KIRO_RATE_LIMIT_DEFAULT = {
  maxAttempts: 8,
  baseDelayMs: 400,
  maxDelayMs: 8000,
  jitterRatio: 0.5
};

/**
 * Jittered exponential backoff for a given retry attempt (1-based).
 * delay = clamp(base * 2^(attempt-1), 0, max), then apply ± jitterRatio noise.
 * Jitter de-synchronizes our retries from other clients hammering the same
 * upstream so we don't all wake up and collide on the same freed slot.
 */
export function jitteredBackoff(attempt, { baseDelayMs, maxDelayMs, jitterRatio } = {}) {
  const base = baseDelayMs ?? KIRO_RATE_LIMIT_DEFAULT.baseDelayMs;
  const max = maxDelayMs ?? KIRO_RATE_LIMIT_DEFAULT.maxDelayMs;
  const ratio = jitterRatio ?? KIRO_RATE_LIMIT_DEFAULT.jitterRatio;
  const exp = Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max);
  const noise = exp * ratio * (Math.random() * 2 - 1); // ± ratio
  return Math.max(0, Math.round(exp + noise));
}

// Normalize a retry entry to { attempts, delayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
