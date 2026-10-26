import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, requestScoped?: boolean }}
 *
 * `shouldFallback` answers "is the CREDENTIAL at fault?" (account rotation).
 * `requestScoped` answers "is the REQUEST itself what this member rejected?"
 * (combo rotation). They are different questions: a context overflow or a
 * validation 400 means the credential is healthy but this member cannot serve
 * this request, so combo rotation must still try the next member.
 */
export function checkFallbackError(status, errorText, backoffLevel = 0, provider = null) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  // A model-specific 404/406 is not an account failure. Keep this decision
  // ahead of the generic 404 rule so a bad model does not lock a healthy key.
  // checkComboFallbackError turns the same classification into a model-only
  // fallback, while account handlers simply surface the original error.
  const explicitlyModelScoped = MODEL_ERROR_MARKERS.some((marker) => lowerError.includes(marker));
  if (explicitlyModelScoped && isModelScopedError(status, errorText)) {
    return { shouldFallback: false, cooldownMs: 0 };
  }

  // Unsupported media is a property of the request, not the credential. Some
  // providers return it as 400 rather than 415, and their wording can match a
  // generic ERROR_RULES entry, so classify it before those rules.
  if (status === 415 || (status === 400 && /unsupported\s+(?:media|mime)/u.test(lowerError))) {
    return { shouldFallback: false, cooldownMs: 0 };
  }

  for (const rule of ERROR_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }
  }

  // Request-scoped client errors that matched no rule above: a 400 caused by the
  // request itself (context overflow, malformed body, unsupported parameter) says
  // nothing about the credential, so cooling the account down only removes a
  // healthy connection from rotation. With a single connection it is worse: every
  // later request in the window fails with a copy of this very error
  // ("all 1 accounts locked for <model> | lastError=[400]: ..."), which hides the
  // real cause from the caller and makes unrelated sessions look like they hit the
  // same limit. Hand the upstream error back for this request instead.
  // Account-scoped statuses keep their rules above (401/402/403/404/429), and the
  // text rules still win for rate-limit / quota / capacity wording.
  if (status >= 400 && status < 500 && status !== 401 && status !== 402 && status !== 403 && status !== 429) {
    return { shouldFallback: false, cooldownMs: 0, requestScoped: true };
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/**
 * Error wording that names the MODEL itself as the problem. Kept next to
 * ERROR_RULES because it is the same kind of config-driven classification, just
 * for a different scope.
 *
 * A combo walks an ORDERED LIST OF MODELS, so "this model cannot serve this
 * request" means "ask the next entry", not "the caller's request is invalid".
 * The wording below is what the upstreams actually answer with — OpenAI-family
 * `model_not_found` / `Invalid model identifier`, Anthropic `model_not_supported`,
 * vendor 404s `... does not exist`.
 *
 * Deliberately free of CONTEXT_SIZE_MARKERS: a 400 that says "maximum context
 * length exceeded" is request-scoped, and one that says "model context length"
 * names the model only as the size reference, never as the failure. Keep the two
 * disjoint so an error can only classify one way.
 */
export const MODEL_ERROR_MARKERS = [
  "model_not_found",
  "model not found",
  "invalid model identifier",
  "invalid model id",
  "unsupported_model",
  "model_not_supported",
  "model not supported",
  "unsupported model",
  "unknown model",
  "no such model",
  "does not exist"
];

/**
 * Error wording that proves the REQUEST's own payload is at fault (too long, or
 * unparseable). These are request-scoped even when they name a model parameter:
 * every candidate in a combo would answer the same way, so the combo loop must
 * hand the upstream error back instead of burning the whole ladder on it.
 */
export const CONTEXT_SIZE_MARKERS = [
  "context length",
  "context_length",
  "context window",
  "context limit",
  "maximum context",
  "max context",
  "max_tokens",
  "maximum tokens",
  "too long",
  "too many tokens",
  "token limit",
  "exceeds the limit"
];

/** Only 4xx can be model-scoped; 5xx and 429 are transient/rate-limit classes. */
const MODEL_SCOPED_STATUS_MIN = 400;
const MODEL_SCOPED_STATUS_MAX = 499;

/**
 * Statuses the ACCOUNT rule already owns explicitly: auth, billing, permission
 * and rate-limit classes are credential/transient verdicts, never "a different
 * model would help". They keep their existing behaviour (and their cooldowns).
 */
const ACCOUNT_SCOPED_STATUSES = new Set([401, 402, 403, 429]);

/** Statuses whose OpenAI-compatible error type IS a model problem (404/406). */
const MODEL_SCOPED_STATUSES = new Set([404, 406]);

function normalizeErrorText(errorText) {
  if (!errorText) return "";
  if (typeof errorText === "string") return errorText.toLowerCase();
  try {
    return JSON.stringify(errorText).toLowerCase();
  } catch {
    return String(errorText).toLowerCase();
  }
}

/**
 * Check if an error is scoped to the MODEL rather than to the account or the
 * request, i.e. whether a DIFFERENT model has a real chance of succeeding.
 *
 * This is deliberately a SEPARATE entry point from `checkFallbackError`:
 * `checkFallbackError` answers "should this ACCOUNT be cooled down and skipped",
 * and its request-scoped-4xx guard must stay intact there — a 400 caused by the
 * request never warrants locking a healthy credential out of rotation. The combo
 * loop asks a different question ("should I try the next MODEL"), and the answer
 * for a model-scoped failure is yes even though the account is perfectly healthy.
 *
 * Model-scoped means one of:
 *   - the error wording names the model (see MODEL_ERROR_MARKERS), or
 *   - the status is 404/406, whose OpenAI-compatible error type is
 *     model_not_found / model_not_supported.
 * A request-scoped 4xx (malformed payload, context overflow) is NOT model-scoped.
 * Neither is any 5xx — a provider-side failure says nothing about the model id —
 * and neither are 401/402/403/429, which the account rule already classifies as
 * credential or rate-limit failures (steering those to "try the next model" would
 * hide a dead credential behind a different model's answer).
 *
 * @param {number} status - HTTP status code
 * @param {string|object} errorText - Error message text (or error payload)
 * @returns {boolean} true when the next model in a combo should be attempted
 */
export function isModelScopedError(status, errorText) {
  if (!status || status < MODEL_SCOPED_STATUS_MIN || status > MODEL_SCOPED_STATUS_MAX) {
    return false;
  }
  if (ACCOUNT_SCOPED_STATUSES.has(status)) return false;

  const lowerError = normalizeErrorText(errorText);
  if (!lowerError) return MODEL_SCOPED_STATUSES.has(status);

  // Request-scoped payload failures name a model too ("This model's maximum
  // context length is ..."). The context check runs FIRST so the request's own
  // limit wording always wins over the incidental model reference.
  const contextScoped = CONTEXT_SIZE_MARKERS.some((marker) => lowerError.includes(marker));
  const modelNamed = MODEL_ERROR_MARKERS.some((marker) => lowerError.includes(marker));
  if (modelNamed) return !contextScoped;

  // An unrecognised statusText ("Bad Request") must not veto the status itself:
  // 404/406 are model-scoped by definition (see errorConfig.computeErrorShape).
  if (contextScoped) return false;
  return MODEL_SCOPED_STATUSES.has(status);
}

/**
 * Fallback decision for a MODEL-level ladder (combo): "can the NEXT model serve
 * this request?" — the union of the account-level rules and `isModelScopedError`.
 * Shares `checkFallbackError`'s return shape so callers can swap the two.
 *
 * @param {number} status - HTTP status code
 * @param {string|object} errorText - Error message text (or error payload)
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkComboFallbackError(status, errorText, backoffLevel = 0) {
  const decision = checkFallbackError(status, errorText, backoffLevel);
  if (decision.shouldFallback) return decision;

  if (isModelScopedError(status, errorText)) {
    // The credential is healthy — this model simply cannot serve the request.
    // No cooldown is recorded against the account; only the model pointer moves.
    return { shouldFallback: true, cooldownMs: 0 };
  }

  return decision;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}` (or `modelLock___all` when model=null).
 */
export function isModelLockActive(connection, model) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {object} Updated account with error state
 */
export function applyErrorState(account, status, errorText) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error"
  };
}
