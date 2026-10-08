import {
  ERROR_TYPES,
  DEFAULT_ERROR_MESSAGES,
  TRANSIENT_STREAM_ERROR_PATTERNS,
} from "../config/errorConfig.js";

// Bounds how many nested JSON envelopes an error message may hide behind.
const MAX_MESSAGE_UNWRAP_DEPTH = 4;

/**
 * Reduce any upstream error payload to the plain-text message a client can show.
 *
 * Upstreams hand back errors in wildly different shapes: nested `{ error: {...} }`,
 * flat `{ message, type, code }`, or a *stringified* copy of either (double-encoded
 * by a relay). Forwarding the raw JSON leaves clients with an unclassifiable
 * "unknown error" blob, so unwrap to the innermost message instead.
 *
 * @param {unknown} value - Parsed error body, message string, or nested fragment
 * @param {number} [depth] - Internal recursion guard
 * @returns {string} Plain-text message, or "" when nothing readable was found
 */
export function normalizeErrorMessage(value, depth = 0) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    // Double-encoded payloads start with a JSON brace/bracket — try to unwrap.
    if (depth < MAX_MESSAGE_UNWRAP_DEPTH && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        const nested = normalizeErrorMessage(JSON.parse(trimmed), depth + 1);
        if (nested) return nested;
      } catch { /* plain text that merely starts with a brace */ }
    }
    return trimmed;
  }

  if (typeof value !== "object") return String(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = normalizeErrorMessage(item, depth + 1);
      if (nested) return nested;
    }
    return "";
  }

  for (const key of ["message", "error", "detail", "description", "reason"]) {
    const nested = normalizeErrorMessage(value[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

/**
 * True when the text describes an upstream transport/stream failure (dropped
 * hop) rather than a problem with the request or the credential. Provider codes
 * vary, so match provider-agnostically against shared patterns.
 */
export function isTransientStreamError(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return TRANSIENT_STREAM_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

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
export function errorResponse(statusCode, message, extraHeaders = null) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
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

// Error `type` values providers use on error bodies. Kept explicit (rather than
// "any object with a type") so success payloads are never mistaken for failures.
const ERROR_TYPE_HINTS = new Set([
  "error",
  "upstream_error",
  "server_error",
  "api_error",
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "overloaded_error",
  "service_unavailable_error",
]);

/**
 * Detect an error payload that arrived with a *success* status.
 *
 * Relays and gateways answer 200 OK while the body carries the failure, so the
 * status alone cannot be trusted. Without this the body is forwarded as if it
 * were a completion, and the client shows an unclassifiable error (the reported
 * `UnknownError` with a JSON blob in `message`).
 *
 * @param {unknown} payload - Parsed response body
 * @returns {{ message: string, code?: string, type?: string } | null}
 */
export function detectErrorBody(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  // Never override a real completion body.
  if (Array.isArray(payload.choices) && payload.choices.length > 0) return null;
  if (payload.object === "response" && Array.isArray(payload.output)) return null;
  if (Array.isArray(payload.content) && payload.role) return null;

  // A relay may double-encode the error: the payload is fine but its `message`
  // holds a stringified copy of the real error object. Merge it back in.
  let candidate = payload;
  if (typeof payload.message === "string" && payload.message.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(payload.message);
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        candidate = { ...inner, ...payload, message: inner.message ?? payload.message };
      }
    } catch { /* plain text that merely starts with a brace */ }
  }

  const nested = candidate.error && typeof candidate.error === "object" ? candidate.error : null;
  const isError = Boolean(nested)
    || ERROR_TYPE_HINTS.has(candidate.type)
    // Relays also report `{ message, code }` with a numeric HTTP-like code and no
    // type; without this they were forwarded as if they were completions.
    || (typeof candidate.message === "string"
      && (typeof candidate.code === "string" || typeof candidate.code === "number"));
  if (!isError) return null;

  const message = normalizeErrorMessage(nested ?? candidate.message ?? candidate.error);
  if (!message) return null;

  const code = nested?.code || candidate.code;
  const type = nested?.type || candidate.type;
  return {
    message,
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof type === "string" ? { type } : {}),
  };
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

  const contentType = response.headers?.get?.("content-type")?.toLowerCase() || "";
  const looksLikeHtml = contentType.includes("text/html") || /<!doctype\s+html|<html[\s>]/i.test(bodyText);
  if (looksLikeHtml) {
    const title = bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      statusCode: response.status,
      message: title || `Upstream returned an HTML error page (${response.status})`
    };
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        // Executors may hand back the raw body (base.parseError) or a
        // double-encoded message — unwrap to text before it reaches the client.
        const msg = normalizeErrorMessage(parsed.message)
          || DEFAULT_ERROR_MESSAGES[response.status]
          || `Upstream error: ${response.status}`;
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs: parsed.resetsAtMs };
      }
    } catch { /* fall through to default parsing */ }
  }

  const finalMessage = normalizeErrorMessage(bodyText)
    || DEFAULT_ERROR_MESSAGES[response.status]
    || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @param {object} [extraHeaders] - Upstream response headers to forward (rate-limit hints etc.)
 * @param {number} [accountStatus] - Original provider status used for account fallback classification
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number, accountStatus?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, extraHeaders = null, accountStatus = statusCode) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    accountStatus,
    response: errorResponse(statusCode, message, extraHeaders)
  };
}

/**
 * Map nonstandard upstream statuses to broadly retryable client statuses.
 * A transport/stream failure is transient regardless of the status the upstream
 * happened to report (some answer 200 with an error body), so those surface as
 * 502 — the client retries instead of failing on an unclassifiable error.
 * @param {number} statusCode - Upstream status
 * @param {string} [message] - Parsed upstream error message
 */
export function getClientErrorStatus(statusCode, message = "") {
  if (statusCode === 400 || statusCode === 524) return 502;
  if (isTransientStreamError(message)) return 502;
  return statusCode;
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman, extraHeaders = null) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
        // Intentionally mis-cased to prevent duplicate headers
        "retry-after": String(retryAfterSec)
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
