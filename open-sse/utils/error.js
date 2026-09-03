import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, isPermanentModelError } from "../config/errorConfig.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";

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
 * Best-effort extraction of a precise rate-limit reset time from common
 * provider error shapes. GLM/Z.AI: "Your limit will reset at 2026-08-17 02:56:15"
 * (UTC). Also handles "retry in N seconds", "resets in Ns" and Retry-After.
 * Returns epoch ms or null.
 */
export function extractResetsAtMs(response, message) {
  if (!message) return null;
  const text = typeof message === "string" ? message : JSON.stringify(message);

  // GLM/Z.AI: "reset at 2026-08-17 02:56:15" (provider sends UTC without suffix)
  const resetAt = text.match(/reset at\s+(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/i);
  if (resetAt) {
    const ms = Date.parse(`${resetAt[1]}T${resetAt[2]}Z`);
    if (Number.isFinite(ms) && ms > Date.now()) return ms;
  }

  // "retry in 300 seconds" / "resets in 5 minutes" / "try again in 1 hour"
  const inTime = text.match(/(?:retry|try again|resets?)\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)/i);
  if (inTime) {
    const n = Number(inTime[1]);
    const unit = inTime[2][0].toLowerCase();
    const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000;
    const ms = Date.now() + n * mult;
    if (Number.isFinite(ms)) return ms;
  }

  // Retry-After header (seconds or HTTP-date)
  const ra = response?.headers?.get?.("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs > 0) return Date.now() + secs * 1000;
    const dateMs = Date.parse(ra);
    if (Number.isFinite(dateMs) && dateMs > Date.now()) return dateMs;
  }

  return null;
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
        // Executor parse wins; fill resetsAtMs from generic patterns when absent
        const resetsAtMs = parsed.resetsAtMs ?? (response.status === 429 ? extractResetsAtMs(response, msg) : null);
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs };
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

  // Generic reset-time extraction for rate limits (GLM "reset at ...", Retry-After, ...)
  if (response.status === 429) {
    const resetsAtMs = extractResetsAtMs(response, finalMessage);
    if (resetsAtMs) return { statusCode: 429, message: finalMessage, resetsAtMs };
  }

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, clientStatus = null) {
  return {
    success: false,
    // The true upstream status, kept for internal classification (fallback
    // rules, cooldowns) so those keep seeing what the provider actually said.
    status: statusCode,
    error: message,
    resetsAtMs,
    // What the CLIENT sees, which may be normalised — e.g. an unknown model
    // reported as 401 becomes 404, so callers do not read it as an auth failure.
    response: errorResponse(clientStatus ?? statusCode, message)
  };
}

/**
 * Map an upstream failure onto the status the client should see.
 *
 * The contract clients actually depend on is coarse: 4xx means stop, 5xx means
 * retry. So the rule is to preserve the upstream's CLASS, never to flatten it.
 *
 * An earlier version of this collapsed every non-429 4xx to 503 to stop a
 * flaky upstream killing a turn. That was the wrong lever: the real cause of
 * those mislabelled statuses was stale per-connection error state being replayed
 * across requests (fixed in auth.js), and the flattening made permanent failures
 * — a rejected temperature, a nonexistent model — look transient. Clients then
 * burned their whole retry budget on hopeless requests, and 5xx bypassed the
 * reactive repair paths that key off a 4xx naming the rejected parameter.
 *
 * Wrong-model errors are the one deliberate re-mapping: providers report them as
 * 400, as 404, and as 401-with-a-ModelError-body. Passing a 401 through makes a
 * client report "authentication failed" for perfectly good credentials, so those
 * are normalised to 404.
 *
 * @param {number|string|null} upstreamStatus - status from the upstream attempt
 * @param {string|object} [errorText] - upstream error text, for model detection
 * @returns {number} status to return to the client
 */
export function clientStatusForUpstream(upstreamStatus, errorText = null) {
  if (isPermanentModelError(errorText)) return HTTP_STATUS.NOT_FOUND;

  const status = Number(upstreamStatus);
  // Nothing usable to propagate (no attempt made, or a non-numeric code): this
  // is our own "no capacity" condition, which is genuinely transient.
  if (!Number.isFinite(status) || status < 400) return HTTP_STATUS.SERVICE_UNAVAILABLE;
  // Anything already carrying a real class keeps it — 4xx stop, 5xx retry.
  if (status <= 599) return status;
  return HTTP_STATUS.SERVICE_UNAVAILABLE;
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
