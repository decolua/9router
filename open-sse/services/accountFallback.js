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
 * Parse retry time from error message or JSON body
 * Handles Google CloudCode formats:
 *  - "quotaResetTimeStamp": "2026-08-10T03:36:51Z"
 *  - "retryDelay": "347406.131768759s"
 *  - "Resets in 96h30m6s", "reset after 2h7m23s", "try again after 1h30m"
 */
export function parseRetryFromErrorMessage(errorText) {
  if (!errorText) return null;
  const str = typeof errorText === "string" ? errorText : JSON.stringify(errorText);

  // 1. Check for explicit ISO timestamp in metadata: "quotaResetTimeStamp": "2026-08-10T03:36:51Z"
  const tsMatch = str.match(/quotaResetTimeStamp["\s:]+["']?([^"'\s}]+)/i);
  if (tsMatch && tsMatch[1]) {
    const ts = new Date(tsMatch[1]).getTime();
    if (!isNaN(ts) && ts > Date.now()) {
      return ts - Date.now();
    }
  }

  // 2. Check for retryDelay in seconds: "retryDelay": "347406.131768759s"
  const secMatch = str.match(/retryDelay["\s:]+["']?(\d+(?:\.\d+)?)s?/i);
  if (secMatch && secMatch[1]) {
    const secs = parseFloat(secMatch[1]);
    if (!isNaN(secs) && secs > 0) {
      return Math.round(secs * 1000);
    }
  }

  // 3. Check text durations: "Resets in 96h30m6s", "reset after 2h7m", "try again after 1h"
  const match = str.match(/(?:resets? in|reset after|try again after|in)\s*(\d+h)?(\d+m)?(\d+(?:\.\d+)?s)?/i);
  if (match && (match[1] || match[2] || match[3])) {
    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1], 10) * 3600 * 1000;
    if (match[2]) totalMs += parseInt(match[2], 10) * 60 * 1000;
    if (match[3]) totalMs += Math.round(parseFloat(match[3]) * 1000);
    return totalMs > 0 ? totalMs : null;
  }

  return null;
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

  // Provider-reported reset time (e.g. "try again after 2h7m23s") takes precedence over fixed backoff
  const parsedMs = parseRetryFromErrorMessage(errorText);
  if (parsedMs) {
    const cappedMs = Math.min(parsedMs, 24 * 60 * 60 * 1000);
    return { shouldFallback: true, cooldownMs: cappedMs, newBackoffLevel: Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel) };
  }

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

/** Strip provider prefix if present (e.g. "antigravity/claude-opus-4-6" -> "claude-opus-4-6") */
export function normalizeModelLockName(model) {
  if (!model) return null;
  return model.replace(/^[^/]+\//, "");
}

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}`, normalized key, or `modelLock___all`.
 */
export function isModelLockActive(connection, model) {
  if (!connection) return false;
  if (connection[MODEL_LOCK_ALL]) {
    const allExpiry = connection[MODEL_LOCK_ALL];
    if (allExpiry && new Date(allExpiry).getTime() > Date.now()) return true;
  }
  if (!model) return false;

  const rawKey = getModelLockKey(model);
  const normModel = normalizeModelLockName(model);
  const normKey = getModelLockKey(normModel);

  const expiry = connection[rawKey] || connection[normKey];
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
 * Sets both raw and normalized model lock keys.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const isoStr = new Date(Date.now() + cooldownMs).toISOString();
  if (!model) return { [MODEL_LOCK_ALL]: isoStr };

  const rawKey = getModelLockKey(model);
  const normModel = normalizeModelLockName(model);
  const normKey = getModelLockKey(normModel);

  const update = { [rawKey]: isoStr };
  if (normKey !== rawKey) {
    update[normKey] = isoStr;
  }
  return update;
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
