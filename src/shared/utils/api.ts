/**
 * API utility functions for making HTTP requests
 */

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

/**
 * Handle API response
 */
async function handleResponse(response: Response) {
  const data = await response.json();

  if (!response.ok) {
    const error: any = new Error(data.error || "An error occurred");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Make a GET request
 */
export async function get(url: string, options: any = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse(response);
}

/**
 * Make a POST request
 */
export async function post(url: string, data: any, options: any = {}) {
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
 */
export async function put(url: string, data: any, options: any = {}) {
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
 */
export async function del(url: string, options: any = {}) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse(response);
}

const api = { get, post, put, del };
export default api;
