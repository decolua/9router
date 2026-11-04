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

const QUOTA_EXHAUSTION_PHRASES = [
  "free usage limit reached",
  "daily free quota exceeded",
  "free quota has been exhausted",
  "free quota exhausted",
  "quota has been exhausted",
  "quota exhausted",
  "quota exceeded",
  "quota is exhausted",
  "quota is exceeded",
  "quota limit exceeded",
  "usage limit reached",
  "usage limit exceeded",
];

/**
 * Issue #5359: free-tier quota exhaustion. HTTP 200 bodies and SSE error
 * envelopes can carry these messages, so detection is text-driven and the
 * status only gates plain 4xx (403/429 need quota wording, not any error).
 */
export function detectQuotaExhaustion(status, errorText, nowMs = Date.now()) {
  const text = errorText ? (typeof errorText === "string" ? errorText : safeStringify(errorText)) : "";
  const lower = text.toLowerCase();
  const exhausted = QUOTA_EXHAUSTION_PHRASES.some((phrase) => lower.includes(phrase))
    || /quota\s+resets?\s+at/.test(lower);
  if (!exhausted) return { exhausted: false, resetAtMs: null };

  let resetAtMs = null;
  if (errorText && typeof errorText === "string") {
    try {
      const parsed = JSON.parse(errorText);
      resetAtMs = findNestedResetMs(parsed) || null;
    } catch { /* plain text — scan below */ }
  }
  if (!resetAtMs) {
    const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g) || [];
    for (const candidate of iso) {
      const ms = Date.parse(candidate);
      if (Number.isFinite(ms) && ms > nowMs) { resetAtMs = ms; break; }
    }
  }
  return { exhausted: true, resetAtMs: resetAtMs && resetAtMs > nowMs ? resetAtMs : null };
}

function safeStringify(value) {
  try { return JSON.stringify(value) || ""; } catch { return String(value); }
}

function findNestedResetMs(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const ms = findNestedResetMs(item, depth + 1); if (ms) return ms; }
    return null;
  }
  for (const key of ["resetsAtMs", "resetAt", "reset_at", "resets_at", "resetTime", "reset_time"]) {
    if (value[key] === undefined || value[key] === null) continue;
    const ms = typeof value[key] === "number"
      ? value[key]
      : Date.parse(String(value[key]));
    if (Number.isFinite(ms)) return ms;
  }
  for (const item of Object.values(value)) {
    const ms = findNestedResetMs(item, depth + 1);
    if (ms) return ms;
  }
  return null;
}

/**
 * Quota lockout is account-wide and persisted on the connection record,
 * separate from isActive: an auto timer must never re-enable an account the
 * user disabled, and manual lockouts survive restarts.
 */
export function isQuotaLockoutActive(connection, nowMs = Date.now()) {
  const lockout = connection?.quotaLockout;
  if (!lockout?.status) return false;
  if (lockout.reactivateAt === null) return true;
  const ms = Date.parse(lockout.reactivateAt);
  return !Number.isFinite(ms) || ms > nowMs;
}

export function buildQuotaLockoutUpdate({ status, message, resetAtMs = null, source = "auto", reactivateAt } = {}) {
  const resolvedReactivateAt = reactivateAt !== undefined
    ? reactivateAt
    : (resetAtMs ? new Date(resetAtMs).toISOString() : null);
  return {
    quotaLockout: {
      status: "quota_exhausted",
      httpStatus: status ?? null,
      message: (typeof message === "string" ? message : safeStringify(message)).slice(0, 500),
      source,
      detectedAt: new Date().toISOString(),
      reactivateAt: resolvedReactivateAt,
    },
  };
}

export function clearQuotaLockoutUpdate() {
  return { quotaLockout: null };
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
    if (isQuotaLockoutActive(acc)) return false;
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
