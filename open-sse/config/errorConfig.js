// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  cloudflareTimeout: 2 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  { provider: "codex", text: "model is not supported when using codex with a chatgpt account", cooldownMs: MAX_RATE_LIMIT_COOLDOWN_MS },
  // Intl gateway blocks affect the account/IP, so let the connection back off.
  { provider: "codebuddy-intl", text: "request illegal", backoff: true },
  { provider: "codebuddy-intl", text: "conversation id missing", backoff: true },
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "insufficient credit",      backoff: true },
  { text: "credit balance is too low", backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 524, cooldownMs: COOLDOWN.cloudflareTimeout },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};

/**
 * In-band stream/transport failures: the upstream hop dropped mid-request, not a
 * problem with the request or credential. Providers report these inside 200-OK
 * SSE bodies (or as error bodies) with provider-specific codes, so the patterns
 * stay provider-agnostic — matched case-insensitively against the raw error text.
 * Treating them as transient lets the router retry (and keeps them out of the
 * client's "unknown error" bucket).
 */
export const TRANSIENT_STREAM_ERROR_PATTERNS = [
  "server_is_overloaded",
  "service_unavailable_error",
  "http2_stream_error",
  "stream_error",
  "stream_failed",
  "stream_disconnected",
  "stream_closed",
  "upstream_disconnected",
  "connection_reset",
  "connection_error",
  "econnreset",
  "socket_hang_up",
  "premature_close",
  "network_error",
  "transport_error",
  // Human-readable transport phrasings (upstream bodies/events use prose too).
  // Deliberately narrow: this list is also scanned against the first bytes of a
  // 200-OK SSE body, so only phrasings that cannot appear as normal prose qualify.
  "http/2 stream failed",
  "http2 stream failed",
  "socket hang up",
  "temporarily overloaded",
];

/**
 * Extra phrasings that make a stream failure worth an in-router retry. Only
 * consulted before any content reached the client, so broader wording is safe.
 */
export const PRE_CONTENT_RETRY_PATTERNS = [
  "overload",
  "unavailable",
  "timeout",
  "timed out",
  "connection",
  "upstream",
  "try again",
  "capacity",
  "server_error",
  "internal error",
  "rate_limit",
  "rate limit",
  "too many requests",
  "terminated",
];

/** In-band errors that mean the account/model is saturated → rotate accounts. */
export const ACCOUNT_SCOPE_STREAM_ERROR_PATTERNS = [
  "selected model is at capacity",
  "model_at_capacity",
];
