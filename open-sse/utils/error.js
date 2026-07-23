import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, errorCode?: string|number|null, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const bodyError = parseErrorBody(bodyText);
        const msg = (parsed.message && parsed.message !== bodyText ? parsed.message : bodyError.message)
          || DEFAULT_ERROR_MESSAGES[response.status]
          || `Upstream error: ${response.status}`;
        const resetsAtMs = Math.max(parsed.resetsAtMs || 0, parseProviderResetTime(response, bodyText) || 0) || undefined;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          errorCode: parsed.code ?? bodyError.code,
          resetsAtMs,
        };
      }
    } catch { /* fall through to default parsing */ }
  }

  const parsed = parseErrorBody(bodyText);
  const finalMessage = parsed.message || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;
  return {
    statusCode: response.status,
    message: finalMessage,
    errorCode: parsed.code,
    resetsAtMs: parseProviderResetTime(response, bodyText) || undefined,
  };
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Resolve an absolute recovery timestamp from Retry-After or resets_at/reset_at. */
export function parseProviderResetTime(response, bodyText = "", now = Date.now()) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  const headerTime = retryAfter && Number.isFinite(retryAfterSeconds)
    ? now + Math.max(retryAfterSeconds, 0) * 1000
    : toTimestamp(retryAfter);
  let bodyTime = 0;
  try {
    const json = JSON.parse(bodyText);
    bodyTime = toTimestamp(json?.error?.resets_at ?? json?.error?.reset_at ?? json?.resets_at ?? json?.reset_at);
  } catch { /* no structured reset time */ }
  const future = Math.max(headerTime, bodyTime);
  return future > now ? future : 0;
}

export function parseErrorBody(bodyText) {
  if (typeof bodyText !== "string" || !bodyText) return { message: "", code: null };
  try {
    const json = JSON.parse(bodyText);
    const error = json?.error;
    const message = error?.message
      || json?.message
      || json?.detail?.message
      || (typeof json?.detail === "string" ? json.detail : null)
      || error
      || bodyText;
    return {
      message: typeof message === "string" ? message : JSON.stringify(message),
      code: error?.code ?? null,
    };
  } catch {
    if (/^\s*</.test(bodyText)) {
      const title = bodyText.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      return { message: title || "Upstream returned an HTML error page", code: null };
    }
    return { message: bodyText, code: null };
  }
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @param {{errorCode?: string|number|null, upstreamStatus?: number|null, isUpstreamError?: boolean}} [meta]
 * @returns {{ success: false, status: number, error: string, errorCode: string|number|null, upstreamStatus: number|null, isUpstreamError: boolean, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, meta = {}) {
  return {
    success: false,
    status: statusCode,
    error: message,
    errorCode: meta.errorCode ?? null,
    upstreamStatus: meta.upstreamStatus ?? null,
    isUpstreamError: meta.isUpstreamError === true,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
