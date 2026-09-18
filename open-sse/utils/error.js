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
 * @param {number} [retryAfterSec] - Seconds until the caller may retry (emits Retry-After)
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message, retryAfterSec) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };
  // Pass the upstream cooldown through to the client. Without this an OpenAI-
  // compatible caller sees a bare 429 and falls back to its own short generic
  // backoff, hammering a provider that already told us how long to wait.
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    headers["Retry-After"] = String(Math.ceil(retryAfterSec));
  }
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers
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
 * Read an upstream cooldown hint into an absolute epoch-ms deadline.
 * Handles both Retry-After forms (delta-seconds and HTTP-date) plus the
 * `retry_after` / `retryDelay` body fields providers use instead.
 * @param {Response} response - Fetch response from provider
 * @param {string} bodyText - Raw response body (already consumed)
 * @returns {number|undefined} epoch ms when the caller may retry
 */
function parseUpstreamCooldown(response, bodyText) {
  const now = Date.now();

  const toMs = (raw) => {
    if (raw === null || raw === undefined) return undefined;
    // "30" / 30 / "30s" -> delta seconds
    const secs = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/s$/i, ""));
    if (Number.isFinite(secs)) return secs > 0 ? now + secs * 1000 : undefined;
    // HTTP-date -> absolute
    const at = Date.parse(String(raw));
    return Number.isFinite(at) && at > now ? at : undefined;
  };

  const header = toMs(response?.headers?.get?.("retry-after"));
  if (header) return header;

  try {
    const json = JSON.parse(bodyText);
    const err = json?.error && typeof json.error === "object" ? json.error : json;
    return toMs(err?.retry_after ?? err?.retryAfter ?? err?.retryDelay);
  } catch {
    return undefined;
  }
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
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
        const msg = parsed.message || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          // Executor-parsed cooldown wins; fall back to the generic header/body hint.
          resetsAtMs: parsed.resetsAtMs ?? parseUpstreamCooldown(response, bodyText),
        };
      }
    } catch { /* fall through to default parsing */ }
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    message = json.error?.message || json.message || json.error || bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage, resetsAtMs: parseUpstreamCooldown(response, bodyText) };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs) {
  const retryAfterSec = Number.isFinite(resetsAtMs)
    ? Math.max(Math.ceil((resetsAtMs - Date.now()) / 1000), 1)
    : undefined;
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message, retryAfterSec)
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
