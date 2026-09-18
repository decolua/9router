export const DEFAULT_FETCH_TIMEOUT_MS = 10000;

/**
 * fetch() with a deadline that actually cancels the request.
 *
 * Racing fetch against a rejecting timer only stops the caller waiting — the
 * socket stays open until the upstream answers, so a hung host keeps holding a
 * connection. Aborting the controller ends the request itself.
 *
 * A caller that supplies its own `signal` already owns the deadline and is
 * passed through untouched.
 *
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  if (options?.signal) return fetch(url, options);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
