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
  GATEWAY_TIMEOUT: 504,
  CLIENT_CLOSED_REQUEST: 499
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

const MAX_TIMER_MS = 2 ** 31 - 1;

function envMs(name, def, min = 1) {
  const raw = process.env[name]?.trim();
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= min && value <= MAX_TIMER_MS ? value : def;
}

function envUrl(name, def) {
  const raw = process.env[name]?.trim();
  return raw || def;
}

// SearXNG endpoint used by the unauthenticated web-search provider.
// Configure this for a separate Docker service or remote SearXNG instance.
export const SEARXNG_URL = envUrl("SEARXNG_URL", "http://localhost:8888/search");

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
const streamStallOverride = envMs("STREAM_STALL_TIMEOUT_MS", undefined);
export const STREAM_STALL_TIMEOUT_MS = streamStallOverride ?? 360_000;
export const resolveStreamStallTimeoutMs = (providerStallTimeoutMs) =>
  streamStallOverride ?? providerStallTimeoutMs ?? STREAM_STALL_TIMEOUT_MS;

// Downstream SSE comments keep idle connections open without counting as upstream activity.
export const STREAM_HEARTBEAT_INTERVAL_MS = envMs("STREAM_HEARTBEAT_INTERVAL_MS", 15_000, 0);

// Absolute wait for the first usable output after headers, including SSE metadata.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200_000);
export const STREAM_TERMINAL_GRACE_MS = envMs("STREAM_TERMINAL_GRACE_MS", 3000, 0);
export const STREAM_PREFLIGHT_MAX_BYTES = 1024 * 1024;

// Combo empty-content failover: how long a 2xx stream may be held while waiting for its first
// content-bearing frame before committing to that model (fail-open on expiry).
// Env: EMPTY_PEEK_DEADLINE_MS.
export const EMPTY_PEEK_DEADLINE_MS = envMs("EMPTY_PEEK_DEADLINE_MS", 45 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

// Keep-alive socket TTL. Cap it below upstream/edge idle windows (Cloudflare, AWS Global
// Accelerator / NVIDIA NIM) that drop idle sockets without a TCP RST. keepAliveMaxTimeout is
// clamped to the same value so an upstream `Keep-Alive` header cannot extend it to 600s.
export const DEFAULT_KEEPALIVE_TIMEOUT_MS = 4 * 1000;
export const FRESH_RETRY_KEEPALIVE_TIMEOUT_MS = 1;
export const FETCH_KEEPALIVE_TIMEOUT_MS = envMs("FETCH_KEEPALIVE_TIMEOUT_MS", DEFAULT_KEEPALIVE_TIMEOUT_MS);

export function resolveKeepAliveTimeouts() {
  const timeout = envMs("FETCH_KEEPALIVE_TIMEOUT_MS", DEFAULT_KEEPALIVE_TIMEOUT_MS);
  return { keepAliveTimeout: timeout, keepAliveMaxTimeout: timeout };
}

// Escape hatch: FETCH_FRESH_RETRY=off disables the transport-level replay, leaving only the
// executor's own retry path (which still forces a fresh socket). Defaults to on.
export function isFreshSocketReplayEnabled() {
  const raw = String(process.env.FETCH_FRESH_RETRY ?? "").trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

// Dead keep-alive sockets surface as these codes/substrings; DNS, connect-refused and TLS
// failures are excluded so a real unreachable host is never mistaken for a stale socket.
export const STALE_SOCKET_ERROR_CODES = new Set([
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_HEADERS_TIMEOUT",
]);

export const NON_STALE_SOCKET_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_INVALID_ARG",
]);

// Deliberately excludes a bare "fetch failed": with no error code the upstream may already
// hold the request, and replaying it would send (and bill) the same completion twice.
export const STALE_SOCKET_ERROR_SUBSTRINGS = [
  "other side closed",
  "socket hang up",
];

export const STREAM_HEADERS_TIMEOUT_MS = envMs("STREAM_HEADERS_TIMEOUT_MS", undefined);

export function resolveStreamFetchTimeouts(provider = {}) {
  return {
    streamHeadersTimeoutMs: STREAM_HEADERS_TIMEOUT_MS ?? provider.timeoutMs ?? FETCH_CONNECT_TIMEOUT_MS,
    // The transport guard must allow both handler phases. The handler applies
    // the shorter, phase-specific deadline when appropriate.
    streamBodyTimeoutMs: Math.max(STREAM_FIRST_CHUNK_TIMEOUT_MS, resolveStreamStallTimeoutMs(provider.stallTimeoutMs), STREAM_TERMINAL_GRACE_MS),
  };
}

export function resolveStreamRequestTimeoutMs(headersMs, bodyMs) {
  return Math.min(MAX_TIMER_MS, headersMs + bodyMs);
}

// In-router retry for streams that fail before any content reached the client
// (in-band overload/HTTP2 frames, dropped connections, EOF with no output).
// Pre-content events are held back, so a retry is invisible to the client.
// Delay doubles per attempt. Env: STREAM_PRECONTENT_RETRY_ATTEMPTS (0 disables),
// STREAM_PRECONTENT_RETRY_DELAY_MS.
export const STREAM_PRECONTENT_RETRY_ATTEMPTS = envMs("STREAM_PRECONTENT_RETRY_ATTEMPTS", 3, 0);
export const STREAM_PRECONTENT_RETRY_DELAY_MS = envMs("STREAM_PRECONTENT_RETRY_DELAY_MS", 2000, 0);
export const STREAM_PRECONTENT_RETRY_MAX_DELAY_MS = envMs("STREAM_PRECONTENT_RETRY_MAX_DELAY_MS", 30_000, 0);

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

export const TOKEN_SAVER_HEADER = "x-9router-token-saver";

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  400: { attempts: envMs("HTTP_400_RETRY_ATTEMPTS", 0, 0), delayMs: envMs("HTTP_400_RETRY_DELAY_MS", 1000, 0) },
  500: { attempts: envMs("HTTP_500_RETRY_ATTEMPTS", 3, 0), delayMs: envMs("HTTP_500_RETRY_DELAY_MS", 2000, 0) },
  502: { attempts: envMs("HTTP_502_RETRY_ATTEMPTS", 3, 0), delayMs: envMs("HTTP_502_RETRY_DELAY_MS", 3000, 0) },
  503: { attempts: envMs("HTTP_503_RETRY_ATTEMPTS", 3, 0), delayMs: envMs("HTTP_503_RETRY_DELAY_MS", 2000, 0) },
  504: { attempts: envMs("HTTP_504_RETRY_ATTEMPTS", 2, 0), delayMs: envMs("HTTP_504_RETRY_DELAY_MS", 3000, 0) }
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
