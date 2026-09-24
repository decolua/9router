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
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs: parsed.resetsAtMs };
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
 * Status for the breaker-open path: every account is in cooldown and we already
 * know when the earliest one frees up.
 *
 * A lock is NOT proof the failure was transient. `checkFallbackError` cools an
 * account down for 30s on ANY error it has no rule for, client-fault 400s
 * included, so "all accounts locked" mixes genuinely self-clearing conditions
 * with permanent ones. Remapping the whole path to 503 would resurrect the
 * incident `.claude/rules/error-classification.md` forbids: a 400 "prompt is too
 * long" would come back retryable, the client would wait and resend the same
 * oversized prompt forever instead of compacting it.
 *
 * So exactly one status is remapped, the one that was reported broken:
 *
 *   A 404 whose text does NOT name a model problem. Nothing else produces it —
 *   an unknown model is caught by isPermanentModelError and keeps its 404 — so
 *   what is left is a gateway/routing hop returning a bodyless 404 that the
 *   router itself decided to cool down for two minutes. Reporting that as 404
 *   told clients "this will never work" about a state that cleared itself: the
 *   model was in /v1/models the whole time and served the request once the
 *   window closed, while clients that classify on status burned their retry
 *   budget in six seconds against a two-minute breaker.
 *
 * Everything else keeps the class clientStatusForUpstream gives it, which is the
 * function that rule names as the owner of this decision. In particular 401/402/
 * 403 stay 4xx deliberately: a revoked or unpaid upstream account is not
 * something the caller's retry can fix, so "try again later" would be a lie.
 *
 * @param {number|string|null} upstreamStatus - status of the error that caused the lock
 * @param {string|null} errorText - stored upstream error text
 * @returns {number}
 */
export function clientStatusForBreakerOpen(upstreamStatus, errorText = null) {
  if (Number(upstreamStatus) === HTTP_STATUS.NOT_FOUND && !isPermanentModelError(errorText)) {
    return HTTP_STATUS.SERVICE_UNAVAILABLE;
  }
  return clientStatusForUpstream(upstreamStatus, errorText);
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
