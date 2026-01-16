import { COOLDOWN_MS, BACKOFF_CONFIG } from "../config/constants.js";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 0: 1s, Level 1: 2s, Level 2: 4s... → max 2 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, backoffLevel);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status, errorText, backoffLevel = 0) {
  // Check error message FIRST - specific patterns take priority over status codes
  if (errorText) {
    const errorStr = typeof errorText === "string" ? errorText : JSON.stringify(errorText);
    const lowerError = errorStr.toLowerCase();

    // "Request not allowed" - short cooldown (5s), takes priority over status code
    if (lowerError.includes("request not allowed")) {
      return { shouldFallback: true, cooldownMs: COOLDOWN_MS.requestNotAllowed };
    }

    // Rate limit keywords - exponential backoff
    if (
      lowerError.includes("rate limit") ||
      lowerError.includes("too many requests") ||
      lowerError.includes("quota exceeded") ||
      lowerError.includes("capacity") ||
      lowerError.includes("overloaded")
    ) {
      const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
      return {
        shouldFallback: true,
        cooldownMs: getQuotaCooldown(backoffLevel),
        newBackoffLevel: newLevel
      };
    }
  }

  // 401 - Authentication error (token expired/invalid)
  if (status === 401) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.unauthorized };
  }

  // 402/403 - Payment required / Forbidden (quota/permission)
  if (status === 402 || status === 403) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.paymentRequired };
  }

  // 404 - Model not found (long cooldown)
  if (status === 404) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.notFound };
  }

  // 429 - Rate limit with exponential backoff
  if (status === 429) {
    const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
    return {
      shouldFallback: true,
      cooldownMs: getQuotaCooldown(backoffLevel),
      newBackoffLevel: newLevel
    };
  }

  // 408/500/502/503/504 - Transient errors (short cooldown)
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.transient };
  }

  return { shouldFallback: false, cooldownMs: 0 };
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
