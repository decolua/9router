// Read a timeout (in milliseconds) from an env var, falling back to a default.
// Logs a warning and falls back if the value is not a positive integer.
// Reading happens once at module load — set the env var before importing.
function _parseTimeoutMs(envName, defaultMs) {
  const raw = process.env[envName];
  if (raw == null || raw === "") return defaultMs;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    console.warn(
      `[runtimeConfig] Invalid ${envName}=${JSON.stringify(raw)}; using default ${defaultMs}ms. Expected positive integer in milliseconds.`
    );
    return defaultMs;
  }
  return parsed;
}

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

// Stream stall timeout: abort if no chunk received within this duration.
// Override at runtime via env var NINE_ROUTER_STREAM_STALL_TIMEOUT_MS (milliseconds).
const _stallTimeoutMs = _parseTimeoutMs(
  "NINE_ROUTER_STREAM_STALL_TIMEOUT_MS",
  30 * 1000
);
export const STREAM_STALL_TIMEOUT_MS = _stallTimeoutMs;

// Fetch connect timeout: abort if upstream doesn't return response headers
// within this duration. Override at runtime via env var
// NINE_ROUTER_FETCH_CONNECT_TIMEOUT_MS (milliseconds).
const _fetchConnectTimeoutMs = _parseTimeoutMs(
  "NINE_ROUTER_FETCH_CONNECT_TIMEOUT_MS",
  20 * 1000
);
export const FETCH_CONNECT_TIMEOUT_MS = _fetchConnectTimeoutMs;

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
