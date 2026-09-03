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
export const MAX_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
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
/**
 * Phrases that identify a permanently wrong model name, whatever status the
 * provider chose to attach to it. Providers are wildly inconsistent here: the
 * same class of failure arrives as 400 ("model is not supported"), as 401 with
 * a ModelError body, or as 404. Clients key their retry behaviour off the
 * status, so these are normalised to one permanent status rather than passed
 * through as an auth failure the caller cannot act on.
 */
export const PERMANENT_MODEL_ERROR_PATTERNS = [
  "model is not supported",
  "model not supported",
  "model not found",
  "model does not exist",
  "unknown model",
  "invalid model",
  // Matches a lowercased `"type":"ModelError"` body, which is how at least one
  // provider reports an unknown model — on a 401, of all statuses.
  "modelerror",
];

/**
 * Regex matchers for the same class, needed where the model NAME sits in the
 * middle of the phrase: "Model does-not-exist-xyz is not supported". A plain
 * substring cannot span that.
 */
export const PERMANENT_MODEL_ERROR_REGEXES = [
  /\bmodel\s+\S+\s+is\s+not\s+supported\b/,
  /\bmodel\s+\S+\s+(?:does\s+not\s+exist|not\s+found)\b/,
];

/**
 * Request-scoped failures that are permanent but are NOT about the model — a
 * parameter the model rejects, for instance. These must not cool down the
 * account: the request is the caller's fault, so retrying on another account
 * repeats the same failure, and locking the model makes one client's bad
 * parameter break every other client's good request for the cooldown window.
 *
 * Matched on the INNER error class, because this provider wraps everything in
 * "Upstream request failed:" — including genuinely transient socket errors. The
 * bracketed class after that prefix is what separates them:
 *   permanent : "Upstream request failed: [invalid_request_error] invalid temperature: ..."
 *   transient : "Upstream request failed: connection reset by peer"
 * Matching "invalid_request_error" alone would wrongly catch the transient case,
 * whose envelope also carries that type.
 */
export const PERMANENT_REQUEST_ERROR_REGEXES = [
  /upstream request failed:\s*\[invalid_request_error\]/,
];

/**
 * @param {string|object} errorText - upstream error text or parsed body
 * @returns {boolean} true when the text names a permanently wrong model
 */
export function isPermanentModelError(errorText) {
  if (!errorText) return false;
  const text = (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase();
  if (PERMANENT_MODEL_ERROR_PATTERNS.some((p) => text.includes(p))) return true;
  return PERMANENT_MODEL_ERROR_REGEXES.some((re) => re.test(text));
}

export const ERROR_RULES = [
  // --- Permanent, request-scoped failures (highest priority) ---
  // The model name itself is wrong, so no other account can do better. Without
  // these the default "fall back and cool down" applied: one typo walked every
  // account into cooldown and then answered 503 "try again later" for something
  // retrying can never fix. `permanent` returns the upstream status straight to
  // the caller and leaves account state untouched.
  ...PERMANENT_MODEL_ERROR_PATTERNS.map((text) => ({ text, permanent: true })),
  ...PERMANENT_MODEL_ERROR_REGEXES.map((pattern) => ({ pattern, permanent: true })),
  ...PERMANENT_REQUEST_ERROR_REGEXES.map((pattern) => ({ pattern, permanent: true })),

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
