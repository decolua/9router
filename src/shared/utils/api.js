/**
 * API utility functions for making HTTP requests
 * All requests get a default 30s timeout via AbortSignal.
 */

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Build merged options — avoid bug where `options` spreads override `headers`.
 * Defaults: method, headers, signal (timeout). Caller can override via `options`.
 */
function buildOptions(method, options = {}, body) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders, ...rest } = options;
  return {
    method,
    headers: { ...DEFAULT_HEADERS, ...extraHeaders },
    signal: AbortSignal.timeout(timeoutMs),
    ...body !== undefined ? { body: JSON.stringify(body) } : {},
    ...rest,
  };
}

/**
 * Make a GET request
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options (headers, signal, etc.)
 * @returns {Promise<object>}
 */
export async function get(url, options = {}) {
  const response = await fetch(url, buildOptions("GET", options));
  return handleResponse(response);
}

/**
 * Make a POST request
 * @param {string} url - API endpoint
 * @param {object} data - Request body
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function post(url, data, options = {}) {
  const response = await fetch(url, buildOptions("POST", options, data));
  return handleResponse(response);
}

/**
 * Make a PUT request
 * @param {string} url - API endpoint
 * @param {object} data - Request body
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function put(url, data, options = {}) {
  const response = await fetch(url, buildOptions("PUT", options, data));
  return handleResponse(response);
}

/**
 * Make a DELETE request
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function del(url, options = {}) {
  const response = await fetch(url, buildOptions("DELETE", options));
  return handleResponse(response);
}

/**
 * Handle API response
 * @param {Response} response - Fetch response
 * @returns {Promise<object>}
 */
async function handleResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || "An error occurred");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

const api = { get, post, put, del };
export default api;