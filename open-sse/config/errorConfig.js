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
};

/**
 * 429 sub-classification.
 *
 * Not all 429s are the same and they must NOT be treated the same way:
 *
 *   - "concurrency" 429 = the upstream account is serving too many parallel
 *     requests right now ("too many concurrent requests", "concurrent request
 *     limit exceeded", ...). The account ITSELF is healthy and the quota is NOT
 *     exhausted. Locking the account for minutes (the current behaviour) throws
 *     away a perfectly good account and is exactly the failure mode that appears
 *     once session binding concentrates traffic onto fewer accounts. Correct
 *     handling: treat it as a short-lived, retryable contention signal — retry
 *     after a small jittered delay WITHOUT locking the account.
 *
 *   - "quota" 429 = rate/quota genuinely exhausted for the window
 *     ("rate limit exceeded", "quota exceeded", ...). Keep the existing
 *     exponential-backoff lock so the selector moves to another account.
 *
 * Returns "concurrency" | "quota" | null (null = no strong signal → legacy path).
 */
const CONCURRENCY_429_PATTERNS = [
  "too many concurrent",
  "concurrent request",
  "concurrency limit",
  "too many parallel",
  "parallel request limit",
  "simultaneous request",
  "requests in flight",
];

const QUOTA_429_PATTERNS = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "quota exceeded",
  "quota_exceeded",
  "insufficient quota",
  "exceeded your current quota",
  "usage limit",
  "weekly limit",
  "daily limit",
  "monthly limit",
  "capacity",
  "overloaded",
];

/**
 * Classify a 429 error body/text.
 * @param {number|string} status
 * @param {string} errorText
 * @returns {"concurrency"|"quota"|null}
 */
export function classify429(status, errorText) {
  if (Number(status) !== 429) return null;
  const text = String(errorText || "").toLowerCase();
  if (!text) return null;
  if (CONCURRENCY_429_PATTERNS.some((p) => text.includes(p))) return "concurrency";
  if (QUOTA_429_PATTERNS.some((p) => text.includes(p))) return "quota";
  return null;
}

/** Base delay (ms) before retrying a concurrency-429 on the same account. */
export const CONCURRENCY_RETRY_BASE_MS = 400;
/** Jitter (ms) added on top so parallel clients do not retry in lock-step. */
export const CONCURRENCY_RETRY_JITTER_MS = 600;
/** Max attempts to re-try the same account on a concurrency-429 before failing over. */
export const CONCURRENCY_RETRY_MAX = 3;

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
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
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
