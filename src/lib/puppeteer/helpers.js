/**
 * Puppeteer helper utilities for headless browser automation.
 *
 * Provides retry-resilient wrappers around page.evaluate and
 * page.waitForSelector that recover from "Execution context was destroyed"
 * errors caused by navigation race conditions.
 */

/**
 * Promise-based sleep.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry-resilient page.evaluate wrapper.
 *
 * Retries up to `maxRetries` times when the evaluation fails due to
 * context destruction, navigation, target closure, or protocol errors.
 * Uses linear backoff: 800ms * (attempt + 1).
 *
 * @param {import('puppeteer').Page} page
 * @param {Function} fn - Function to evaluate in browser context
 * @param {...*} args - Arguments forwarded to fn
 * @returns {Promise<*>} Result of page.evaluate
 */
export async function safeEval(page, fn, ...args) {
  const maxRetries = 5;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (e) {
      const msg = e.message || "";
      const isTransient =
        msg.includes("Execution context was destroyed") ||
        msg.includes("navigation") ||
        msg.includes("Target closed") ||
        msg.includes("Protocol error");

      if (isTransient && i < maxRetries - 1) {
        await sleep(800 * (i + 1));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Deadline-based waitForSelector with context destruction recovery.
 *
 * Repeatedly attempts page.waitForSelector in short intervals until the
 * overall deadline is reached.  Unlike the default waitForSelector, this
 * function never throws — it returns `true` when the element is found and
 * `false` when the deadline expires.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} selector - CSS selector to wait for
 * @param {number} [timeoutMs=15000] - Overall deadline in milliseconds
 * @returns {Promise<boolean>} Whether the selector was found
 */
export async function safeWaitForSelector(page, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(deadline - Date.now(), 1000);
      await page.waitForSelector(selector, {
        visible: true,
        timeout: Math.min(remaining, 5000),
      });
      return true;
    } catch (e) {
      const msg = e.message || "";
      const isTransient =
        msg.includes("Execution context was destroyed") ||
        msg.includes("navigation") ||
        msg.includes("Target closed") ||
        msg.includes("Protocol error");

      if (isTransient) {
        await sleep(500);
        continue;
      }

      // Timeout within the short interval — retry if overall deadline not reached
      if (Date.now() >= deadline) return false;
      await sleep(500);
    }
  }

  return false;
}
