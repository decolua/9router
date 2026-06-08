/**
 * fetch with timeout + clean abort for all internal API calls.
 * Prevents hanging requests from blocking the process.
 */

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Wraps fetch() with a timeout via AbortController.
 * On timeout the underlying TCP socket is destroyed (Node 18+).
 *
 * @param {string|URL} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs=30000]
 * @param {AbortSignal} [options.signal]  — external signal to chain with timeout
 * @param {object} [options.rest]         — other fetch options
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...rest } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeoutMs}ms`)), timeoutMs);

  // Chain external signal if provided
  const onExternalAbort = () => {
    clearTimeout(timer);
    controller.abort(externalSignal?.reason || new Error("external abort"));
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Same as fetchWithTimeout but also reads and parses JSON body.
 * Throws on non-ok status.
 *
 * @returns {Promise<{data: object, response: Response}>}
 */
export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  return { data, response };
}