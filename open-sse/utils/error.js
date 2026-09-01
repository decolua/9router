import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message, diagnostics = {}) {
  const errorInfo = ERROR_TYPES[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  const error = {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
  };
  for (const key of ["type", "param", "code", "request_id"]) {
    if (diagnostics[key]) error[key] = diagnostics[key];
  }
  return { error };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message, diagnostics = {}) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message, diagnostics)), {
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
 * @returns {Promise<{statusCode: number, message: string, type?: string, param?: string, code?: string, request_id?: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch { /* use status fallback */ }

  const source = json?.error && typeof json.error === "object" ? json.error : json;
  const diagnostics = {
    type: safeDiagnostic(source?.type),
    param: safeDiagnostic(source?.param),
    code: safeDiagnostic(source?.code),
    request_id: safeRequestId(response, source?.request_id || json?.request_id)
  };
  const providerMessage = source?.message || json?.message || (typeof json?.error === "string" ? json.error : "");

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  let parsed = null;
  if (executor && typeof executor.parseError === "function") {
    try {
      parsed = executor.parseError(response, bodyText);
    } catch { /* fall through to default parsing */ }
  }

  const parsedMessage = parsed && typeof parsed === "object" && parsed.message !== bodyText
    ? parsed.message
    : providerMessage;
  const messageStr = safeDiagnostic(parsedMessage);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return {
    statusCode: parsed?.status || response.status,
    message: finalMessage,
    type: safeDiagnostic(parsed?.type) || diagnostics.type,
    param: safeDiagnostic(parsed?.param) || diagnostics.param,
    code: safeDiagnostic(parsed?.code) || diagnostics.code,
    request_id: safeRequestId(response, parsed?.request_id || diagnostics.request_id),
    resetsAtMs: parsed?.resetsAtMs
  };
}

function safeDiagnostic(value) {
  if (typeof value !== "string") return undefined;
  return value.replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]").replace(/[\r\n\0]/g, " ").trim().slice(0, 500) || undefined;
}

function safeRequestId(response, value) {
  const headerId = response?.headers?.get("x-request-id") || response?.headers?.get("request-id") || response?.headers?.get("x-correlation-id");
  const candidate = safeDiagnostic(value || headerId);
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : undefined;
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, diagnostics = {}) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message, diagnostics)
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
