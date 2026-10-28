/**
 * API utility functions for making HTTP requests
 */

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

/**
 * Make a GET request
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function get(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
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
  const response = await fetch(url, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
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
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse(response);
}

/**
 * Make a DELETE request
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<object>}
 */
export async function del(url, options = {}) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse(response);
}

/**
 * Handle API response
 * @param {Response} response - Fetch response
 * @returns {Promise<object>}
 */
export async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text.trim() || "Invalid non-JSON response", rawText: text };
  }
}

export function getResponseErrorMessage(response, data = {}, fallback = "Request failed") {
  const rawError = data.error || data.errorDescription || data.message;
  const message = typeof rawError === "object"
    ? rawError.message || JSON.stringify(rawError)
    : rawError;
  const cleanMessage = String(message || fallback).trim();
  if (!response) return cleanMessage;

  const statusLabel = response.status
    ? `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
    : "";
  return statusLabel ? `${fallback} (${statusLabel}): ${cleanMessage}` : cleanMessage;
}

export async function handleResponse(response) {
  const data = await parseResponseBody(response);

  if (!response.ok) {
    const error = new Error(getResponseErrorMessage(response, data, "An error occurred"));
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

const api = { get, post, put, del };
export default api;

