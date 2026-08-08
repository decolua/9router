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
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status, errorText, backoffLevel = 0) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
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

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Match a user-configured skip-rule against a failure.
 *
 * A rule's `match` may carry any combination of { kind, status, contains }; the
 * rule matches only when EVERY present condition holds (AND). At least one
 * condition must be present. Rules are evaluated in ARRAY ORDER — the first rule
 * (for this provider) whose conditions all match wins. Order is user-controlled
 * via the settings UI. There is no hardcoded provider default: the legacy
 * Antigravity capacity skip is now shipped as an ordinary seeded rule
 * ({ status:503, contains:"capacity", action:"skip" }) the user can edit or delete.
 *
 * @param {string} provider   provider id (e.g. "anthropic-compatible-<uuid>", "antigravity")
 * @param {{status?: number|string, errorKind?: string, text?: string}} failure
 * @param {Array<{provider, match:{kind?,status?,contains?}, action, headerTimeoutMs?, sweep?}>} skipRules
 * @returns {{action:"retry"|"skip", headerTimeoutMs?:number, sweep?:boolean}|null}
 */
// Minimum for a retry rule's `retryAttempts` (extra calls to the same account).
// There is no maximum: the user decides how many retries they need, and the
// abort guard in chat.js terminates the loop immediately on client disconnect
// regardless of how many budget calls remain.
export const SKIP_RULE_RETRY_ATTEMPTS_MIN = 1;
// Rules saved before `retryAttempts` existed default to 1 extra retry.
export const SKIP_RULE_RETRY_ATTEMPTS_DEFAULT = 1;

/**
 * Effective extra same-account calls for a retry rule.
 * Only positive integers are honoured; anything else (absent, 0, negative,
 * float, string, NaN) falls back to the documented default rather than
 * silently disabling the rule the user asked for.
 * @param {object} rule
 * @returns {number}
 */
export function resolveRetryAttempts(rule) {
  const n = rule?.retryAttempts;
  if (!Number.isInteger(n) || n < SKIP_RULE_RETRY_ATTEMPTS_MIN) return SKIP_RULE_RETRY_ATTEMPTS_DEFAULT;
  return n;
}

export function matchSkipRule(provider, failure = {}, skipRules = []) {
  const r = findMatchingSkipRule(provider, failure, skipRules);
  if (!r) return null;
  const out = { action: r.action };
  if (r.headerTimeoutMs != null) out.headerTimeoutMs = r.headerTimeoutMs;
  // `sweep` is only meaningful for skip rules — it asks the account loop to
  // re-try the whole pool after exhausting it (momentary saturation recovery).
  if (r.action === "skip" && r.sweep === true) out.sweep = true;
  // `retryAttempts` is only meaningful for retry rules: it is the number of EXTRA
  // calls to the SAME account before giving up on it. Resolved here (rather than at
  // the call site) so every consumer sees the same effective value, including the
  // backward-compatible default for rules saved before the field existed.
  if (r.action === "retry") out.retryAttempts = resolveRetryAttempts(r);
  return out;
}

/**
 * Find the FIRST rule (in array order) that matches this failure for `provider`,
 * and return the rule object itself (not a derived shape) — or null.
 *
 * A rule's `match` may carry any combination of { kind, status, contains }; the
 * rule matches only when EVERY present condition holds (AND). At least one usable
 * condition must be present (an empty match never matches — avoids skip-all).
 * Array order is user-controlled via the settings UI (first match wins).
 *
 * @param {string} provider
 * @param {{status?: number|string, errorKind?: string, text?: string}} failure
 * @param {Array} skipRules
 * @returns {object|null} the matching rule object, or null
 */
export function findMatchingSkipRule(provider, failure = {}, skipRules = []) {
  const status = failure.status != null ? Number(failure.status) : null;
  const errorKind = failure.errorKind || null;
  const text = typeof failure.text === "string" ? failure.text.toLowerCase() : "";
  const rules = Array.isArray(skipRules) ? skipRules : [];

  const conditionsMatch = (m) => {
    let has = false;
    if (m.kind != null) {
      has = true;
      if (errorKind == null || m.kind !== errorKind) return false;
    }
    if (m.status != null) {
      has = true;
      if (status == null || Number(m.status) !== status) return false;
    }
    if (m.contains != null && m.contains !== "") {
      has = true;
      if (!text.includes(String(m.contains).toLowerCase())) return false;
    }
    // A match block with no usable condition never matches (avoids skip-all).
    return has;
  };

  for (const r of rules) {
    if (!r || r.provider !== provider || !r.match || !r.action) continue;
    if (conditionsMatch(r.match)) return r;
  }
  return null;
}

/**
 * Resolve the header/connect timeout for a provider from skip-rules.
 * Scans rules matching this provider with match.kind === "connect_timeout" that
 * carry a headerTimeoutMs; earlier rule wins. Returns null → caller uses default.
 */
export function resolveProviderHeaderTimeout(provider, skipRules = []) {
  const rules = Array.isArray(skipRules) ? skipRules : [];
  for (const r of rules) {
    if (r && r.provider === provider && r.match?.kind === "connect_timeout" && r.headerTimeoutMs != null) {
      return r.headerTimeoutMs;
    }
  }
  return null;
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
