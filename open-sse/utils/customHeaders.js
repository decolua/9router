/**
 * Custom headers utility for providers and connections.
 * Supports JSON string or newline-separated "Header-Name: Value" format.
 * Supports placeholder interpolation for {{API_KEY}} and {{apiKey}}.
 * Empty string or null header value suppresses/removes the header.
 */

/**
 * Parse custom headers from string (JSON or "Key: Value" lines) or object.
 * Returns an object of headers, or null if empty/invalid.
 */
export function parseCustomHeaders(input) {
  if (!input) return null;

  if (typeof input === "object" && !Array.isArray(input)) {
    const result = {};
    for (const [k, v] of Object.entries(input)) {
      const key = String(k).trim();
      if (!key) continue;
      result[key] = v != null ? String(v).trim() : "";
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parseCustomHeaders(parsed);
      }
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  const result = {};
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed || lineTrimmed.startsWith("#") || lineTrimmed.startsWith("//")) continue;
    const colonIdx = lineTrimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = lineTrimmed.slice(0, colonIdx).trim();
      const val = lineTrimmed.slice(colonIdx + 1).trim();
      if (key) {
        result[key] = val;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format custom headers into a readable JSON string for UI textareas.
 */
export function formatCustomHeaders(customHeaders) {
  if (!customHeaders) return "";
  if (typeof customHeaders === "string") return customHeaders;
  if (typeof customHeaders === "object" && !Array.isArray(customHeaders)) {
    try {
      return JSON.stringify(customHeaders, null, 2);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Apply custom headers onto a headers object.
 * Supports {{API_KEY}} / {{apiKey}} placeholders.
 * Empty or null value removes/suppresses that header.
 */
export function applyCustomHeaders(headers, customHeaders, credentials = null) {
  if (!headers || !customHeaders || typeof customHeaders !== "object") return headers;

  const apiKey = credentials?.apiKey || credentials?.accessToken || "";

  for (const [rawKey, rawVal] of Object.entries(customHeaders)) {
    const key = String(rawKey).trim();
    if (!key) continue;

    if (rawVal == null || rawVal === "") {
      delete headers[key];
      const lower = key.toLowerCase();
      for (const h of Object.keys(headers)) {
        if (h.toLowerCase() === lower) {
          delete headers[h];
        }
      }
      continue;
    }

    let val = String(rawVal);
    if (apiKey) {
      val = val.replace(/\{\{\s*(?:API_KEY|apiKey)\s*\}\}/g, apiKey);
    }

    headers[key] = val;
  }

  return headers;
}
