// Bounded retry helper with exponential backoff and jitter for transient
// MCP gateway failures. Used by HTTP and stdio clients to handle temporary
// network/upstream blips without surfacing them as fatal errors to the harness.

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_JITTER_RATIO = 0.25;
const DEFAULT_MAX_DELAY_MS = 2000;

/**
 * Exponential backoff + jitter calculator.
 * @param {number} attempt    0-based attempt index (0 = first retry)
 * @param {object} opts       retry policy options
 * @returns {number} delay in milliseconds
 */
function calculateDelay(attempt, opts = {}) {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const factor = opts.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const jitterRatio = opts.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let delay = base * Math.pow(factor, attempt);
  delay = Math.min(delay, max);
  const jitter = delay * jitterRatio * (Math.random() * 2 - 1);
  delay = Math.max(0, delay + jitter);
  return Math.floor(delay);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff and jitter.
 *
 * @param {() => Promise<any>} fn   async function to retry
 * @param {object} opts             retry policy options
 * @returns {Promise<any>}
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
      if (!isTransient(e) || attempt >= maxAttempts - 1) {
        throw e;
      }
      const delayMs = calculateDelay(attempt, opts);
      if (onRetry) {
        onRetry(e, attempt, delayMs);
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Default heuristic for transient vs. permanent errors.
 * @param {unknown} err
 * @returns {boolean}
 */
function defaultIsTransient(err) {
  if (!err) return false;
  const msg = (typeof err.message === "string" ? err.message : "").toLowerCase();
  const code = typeof err.code === "string" ? err.code : "";
  const status = typeof err.status === "number" ? err.status : 0;

  if (err.name === "McpAuthError") return false;
  if (status === 401 || status === 403) return false;
  if (status === 400 || status === 404) return false;

  if (msg.includes("timeout") || msg.includes("timed out")) return true;
  if (msg.includes("econnrefused") || msg.includes("econnreset")) return true;
  if (msg.includes("network") || msg.includes("fetch failed")) return true;
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return true;
  if (code === "ETIMEDOUT" || code === "ENETUNREACH") return true;

  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;

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
