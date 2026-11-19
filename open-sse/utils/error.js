import {
  ERROR_TYPES,
  DEFAULT_ERROR_MESSAGES,
  TRANSIENT_STREAM_ERROR_PATTERNS,
  STREAM_ERROR_STATUS_BY_TYPE,
  STREAM_FAILURE_MESSAGES,
  UPSTREAM_ERROR_UNWRAP_DEPTH,
  UPSTREAM_ERROR_TITLE_MAX_CHARS,
} from "../config/errorConfig.js";
import { HTTP_STATUS, STREAM_FIRST_CHUNK_TIMEOUT_MS, STREAM_PREFLIGHT_MAX_BYTES } from "../config/runtimeConfig.js";

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
  if (value == null || depth > UPSTREAM_ERROR_UNWRAP_DEPTH) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    // Double-encoded payloads start with a JSON brace/bracket — try to unwrap.
    if (/^[{[\"]/.test(trimmed)) {
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

  for (const key of ["message", "error", "detail", "description", "reason", "data", "responseBody", "metadata"]) {
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
  "billing_error",
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
 * @returns {{ message: string, code?: string|number, status?: string|number, type?: string } | null}
 */
export function detectErrorBody(payload, depth = 0) {
  if (depth > UPSTREAM_ERROR_UNWRAP_DEPTH) return null;
  if (typeof payload === "string" && /^[{\"]/.test(payload.trim())) {
    try { return detectErrorBody(JSON.parse(payload), depth + 1); } catch { return null; }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  // Explicit wire errors win even if the provider attached a choices array.
  const explicit = payload.error != null && (hasErrorField(payload.error) || typeof payload.error === "string");
  const envelope = typeof payload.name === "string" && /Error$/.test(payload.name) && payload.data;
  if (!explicit && !envelope) {
    if (payload.choices?.length || (payload.object === "response" && Array.isArray(payload.output))) return null;
    if (Array.isArray(payload.content) && payload.role) return null;
  }

  const source = explicit ? payload.error : envelope ? payload.data : payload;
  const encoded = detectErrorBody(source?.responseBody, depth + 1)
    || detectErrorBody(source?.message, depth + 1)
    || (source !== payload ? detectErrorBody(source, depth + 1) : null);
  const code = [source?.code, source?.metadata?.code, encoded?.code, payload.code].find(
    (value) => typeof value === "number" || (typeof value === "string" && value.trim()),
  );
  const status = source?.statusCode ?? source?.status ?? encoded?.status ?? payload.statusCode ?? payload.status;
  const type = source?.type || encoded?.type || payload.type;
  if (!explicit && !envelope && !encoded && !ERROR_TYPE_HINTS.has(type)
    && !(typeof payload.message === "string" && (code != null || status != null))) return null;

  const message = normalizeErrorMessage(source) || encoded?.message || normalizeErrorMessage(payload.message);
  const errorStatus = getStreamErrorStatus({ status, code, type });
  const transientCode = isTransientStreamError(code);
  if (!message && errorStatus == null && !transientCode) return null;
  return {
    message: message || (transientCode ? describeUpstreamDisconnect({ code }) : STREAM_FAILURE_MESSAGES.reported),
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof status === "string" || typeof status === "number" ? { status } : {}),
    ...(typeof type === "string" ? { type } : {}),
  };
}

function hasErrorField(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStreamErrorStatus(error) {
  for (const value of [error?.status, error?.code]) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const status = Number(value);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return Object.hasOwn(STREAM_ERROR_STATUS_BY_TYPE, error?.type) ? STREAM_ERROR_STATUS_BY_TYPE[error.type] : undefined;
}

export function describeUpstreamDisconnect(error) {
  const code = error?.cause?.code || error?.code || error?.data?.metadata?.code;
  const message = error?.message || error?.data?.message || "";
  if (code === "ECONNRESET" || /econnreset|connection reset by server/i.test(message)) {
    return "Connection reset by upstream server (ECONNRESET)";
  }
  if (code === "UND_ERR_BODY_TIMEOUT") return STREAM_FAILURE_MESSAGES.stall;
  if (code === "UND_ERR_HEADERS_TIMEOUT") return STREAM_FAILURE_MESSAGES.headers;
  if (Object.values(STREAM_FAILURE_MESSAGES).includes(message)) return message;
  return /terminated|socket hang up|other side closed/i.test(message) || code === "UND_ERR_SOCKET"
    ? "upstream connection lost"
    : typeof code === "string" && /^[A-Z_0-9]+$/.test(code) ? `upstream connection lost (${code})` : "upstream connection lost";
}

export function getUpstreamDisconnectStatus(error) {
  const message = describeUpstreamDisconnect(error);
  return message === STREAM_FAILURE_MESSAGES.stall || message === STREAM_FAILURE_MESSAGES.firstOutput || message === STREAM_FAILURE_MESSAGES.headers
    ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
}

export async function readErrorResponseText(response, {
  signal, timeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS, maxBytes = STREAM_PREFLIGHT_MAX_BYTES,
} = {}) {
  signal?.throwIfAborted();
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });
  let text = "";
  let remaining = maxBytes;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      remaining -= value.byteLength;
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response, executor = null, options) {
  let bodyText = "";
  try {
    bodyText = await readErrorResponseText(response, options);
  } catch {
    bodyText = "";
  }

  const contentType = response.headers?.get?.("content-type")?.toLowerCase() || "";
  const looksLikeHtml = contentType.includes("text/html") || /<!doctype\s+html|<html[\s>]/i.test(bodyText);
  if (looksLikeHtml) {
    const title = bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim().slice(0, UPSTREAM_ERROR_TITLE_MAX_CHARS);
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
  if (statusCode === HTTP_STATUS.BAD_REQUEST || statusCode === 524) return HTTP_STATUS.BAD_GATEWAY;
  if (isTransientStreamError(message)) return HTTP_STATUS.BAD_GATEWAY;
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
