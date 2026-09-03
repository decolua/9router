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

// Exponential backoff config for rate limits.
// `max` is the blind ceiling used only when the provider reports no reset time. The
// ladder needs ~9 consecutive failures to reach it, so it applies to accounts that are
// genuinely spent, not to transient throttles. At the old 5 min an account out of
// monthly quota was re-probed ~288 times a day, every day, forever.
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 30 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Sanity ceiling for a provider-reported reset time (resetsAtMs), NOT a policy cap.
// Providers report genuinely long resets: codex `resets_at` runs 5-6h out and
// cloudcode-pa returns `quotaResetTimeStamp` up to ~150h out. Truncating those to
// 30 min put the account straight back into rotation to fail again. This value exists
// only to reject nonsense timestamps (some usage APIs return year 9999), so it sits
// just past the longest legitimate window — a calendar month.
export const MAX_RATE_LIMIT_COOLDOWN_MS = 31 * 24 * 60 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  // Provider says a calendar-month allowance is spent but reports no reset time
  // (e.g. kiro 402 MONTHLY_REQUEST_COUNT). Re-probe a few times a day, not every 2 min.
  monthly: 6 * 60 * 60 * 1000,
  long: 2 * 60 * 1000,
  short: 5 * 1000,
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
  // Monthly allowance spent — must be matched before the generic 402/429 rules.
  { text: "monthly_request_count",    cooldownMs: COOLDOWN.monthly },
  { text: "monthly limit",            cooldownMs: COOLDOWN.monthly },
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
  monthlyQuota: COOLDOWN.monthly,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
