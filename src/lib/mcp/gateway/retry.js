// Bounded retry helper with exponential backoff and jitter for transient
// MCP gateway failures. Used by HTTP and stdio clients to handle temporary
// network/upstream blips without surfacing them as fatal errors to the harness.
//
// Default policy: 3 attempts (initial + 2 retries), 100ms base delay with
// 2× backoff and 25% jitter. Max single delay capped at 2s. Total worst-case
// time ~4.4s for default (100ms + 200ms + 400ms + jitter).

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_JITTER_RATIO = 0.25;
const DEFAULT_MAX_DELAY_MS = 2000;

/**
 * Exponential backoff + jitter calculator.
 * @param {number} attempt    0-based attempt index (0 = first retry, 1 = second, ...)
 * @param {object} opts       { baseDelayMs, backoffFactor, jitterRatio, maxDelayMs }
 * @returns {number}          delay in milliseconds
 */
function calculateDelay(attempt, opts = {}) {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const factor = opts.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const jitterRatio = opts.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  // Exponential: base * (factor ^ attempt)
  let delay = base * Math.pow(factor, attempt);
  // Cap at max
  delay = Math.min(delay, max);
  // Add random jitter: ±jitterRatio of delay
  const jitter = delay * jitterRatio * (Math.random() * 2 - 1);
  delay = Math.max(0, delay + jitter);
  return Math.floor(delay);
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff and jitter.
 * Stops retrying on non-transient errors (auth, validation, etc.).
 *
 * @param {Function} fn                 async function to retry; () => Promise<T>
 * @param {object} [opts]               retry policy options
 * @param {number} [opts.maxAttempts]   total attempts (initial + retries); default 3
 * @param {number} [opts.baseDelayMs]   base delay; default 100ms
 * @param {number} [opts.backoffFactor] backoff multiplier; default 2
 * @param {number} [opts.jitterRatio]   jitter ±%; default 0.25 (25%)
 * @param {number} [opts.maxDelayMs]    max single delay; default 2000ms
 * @param {Function} [opts.isTransient] (err) => boolean; defaults to common network/timeout checks
 * @param {Function} [opts.onRetry]     (err, attempt, delayMs) => void; called before each retry sleep
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const isTransient = opts.isTransient ?? defaultIsTransient;
  const onRetry = opts.onRetry;

  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      // If non-transient or last attempt, bail immediately.
      if (!isTransient(e) || attempt >= maxAttempts - 1) {
        throw e;
      }
      // Transient error and we have retries left: sleep then loop.
      const delayMs = calculateDelay(attempt, opts);
      if (onRetry) {
        onRetry(e, attempt, delayMs);
      }
      await sleep(delayMs);
    }
  }
  // Unreachable in theory, but TypeScript needs a fallback.
  throw lastError;
}

/**
 * Default heuristic for transient vs. permanent errors.
 * Returns true for network/timeout issues, false for auth/validation.
 */
function defaultIsTransient(err) {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const code = err.code || "";
  const status = err.status || 0;

  // Auth errors are permanent.
  if (err.name === "McpAuthError") return false;
  if (status === 401 || status === 403) return false;

  // Validation/not-found are permanent.
  if (status === 400 || status === 404) return false;

  // Timeout, network, connection refused, ECONNRESET, etc. are transient.
  if (msg.includes("timeout") || msg.includes("timed out")) return true;
  if (msg.includes("econnrefused") || msg.includes("econnreset")) return true;
  if (msg.includes("network") || msg.includes("fetch failed")) return true;
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return true;
  if (code === "ETIMEDOUT" || code === "ENETUNREACH") return true;

  // 5xx server errors are transient (upstream overload, etc.).
  if (status >= 500 && status < 600) return true;

  // 429 rate-limit is transient.
  if (status === 429) return true;

  // Unknown: default to non-transient to avoid infinite retry on unexpected errors.
  return false;
}

export const __test__ = {
  calculateDelay,
  sleep,
  defaultIsTransient,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_JITTER_RATIO,
  DEFAULT_MAX_DELAY_MS,
};
