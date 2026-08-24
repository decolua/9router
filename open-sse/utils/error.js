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
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
// A provider that tells you when it comes back should be believed.
//
// markAccountUnavailable already honours a `resetsAtMs` — but only two
// executors (codex, antigravity) ever produced one, so every other provider
// fell through to the flat quota rule and got locked for twelve hours. Measured
// on 2026-08-24: opencode-go returned a 429 whose own text said the limit
// resets in 1h 6m, and the account was locked for 43,200s. OpenRouter's
// free-models-per-day 429 cost eleven hours of a model the operator had just
// made the head of a combo. The default is meant to stop a retry treadmill, not
// to outlive the fact it is guessing about.
//
// Everything below is a standard the provider chose to speak in — RFC 7231
// Retry-After, the de-facto X-RateLimit-Reset, or the same values echoed into
// the JSON body. Nothing here is provider-specific; an executor that knows
// better still wins, because its parseError runs first and returns early.
const RESET_HEADERS = ["retry-after", "x-ratelimit-reset", "x-ratelimit-reset-requests", "ratelimit-reset"];

/** Epoch seconds, epoch millis, or a delta in seconds — decided by magnitude,
 *  because providers disagree and none of them say which they mean. */
function asResetMs(raw, now) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    if (n > 1e12) return n;                    // epoch millis
    if (n > 1e9) return n * 1000;              // epoch seconds
    if (n <= 7 * 24 * 3600) return now + n * 1000; // a delta, capped at a week
    return null;
  }
  const t = Date.parse(String(raw));           // HTTP-date, or an ISO timestamp
  return Number.isFinite(t) && t > now ? t : null;
}

function fromHeaders(response, now) {
  for (const h of RESET_HEADERS) {
    const v = response?.headers?.get?.(h);
    if (v == null || v === "") continue;
    const at = asResetMs(v, now);
    if (at && at > now) return at;
  }
  return null;
}

function fromBody(bodyText, now) {
  let json;
  try { json = JSON.parse(bodyText); } catch { json = null; }
  if (json && typeof json === "object") {
    const meta = json.error?.metadata ?? json.metadata ?? {};
    const headers = meta.headers ?? {};
    const candidates = [
      json.retryAfter, json.retry_after, json.resets_at, json.resetsAt,
      json.error?.retryAfter, json.error?.retry_after, json.error?.resets_at,
      meta.retryAfter, meta.retry_after, meta.resets_at,
      headers["X-RateLimit-Reset"], headers["x-ratelimit-reset"],
      headers["Retry-After"], headers["retry-after"],
    ];
    for (const c of candidates) {
      if (c == null || c === "") continue;
      const at = asResetMs(c, now);
      if (at && at > now) return at;
    }
    const secs = json.error?.resets_in_seconds ?? json.resets_in_seconds;
    if (Number.isFinite(Number(secs)) && Number(secs) > 0) return now + Number(secs) * 1000;
  }

  // Last resort: the duration many providers only ever state in prose —
  // "Monthly usage limit reached. Resets in 1h 6m", "try again in 30 seconds".
  const m = /(?:reset|retry|try again|available)\D{0,20}?(\d+)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d)\b/i.exec(
    String(bodyText || "")
  );
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const mult = unit.startsWith("d") ? 86400 : unit.startsWith("h") ? 3600 : unit.startsWith("m") && unit !== "s" ? 60 : 1;
    if (n > 0) return now + n * mult * 1000;
  }
  return null;
}

/** The provider's own stated return time, or null when it did not give one. */
export function extractResetsAtMs(response, bodyText) {
  const now = Date.now();
  return fromHeaders(response, now) ?? fromBody(bodyText, now);
}

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
        // An executor that knows a provider-specific field wins, but one that
        // simply did not look should not suppress the standard headers.
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          resetsAtMs: parsed.resetsAtMs ?? extractResetsAtMs(response, bodyText),
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

  return { statusCode: response.status, message: finalMessage, resetsAtMs: extractResetsAtMs(response, bodyText) };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 *
 * `retryAfter` is carried in the body as well as the header so that a combo
 * cascade reading this response learns the real expiry instead of inventing a
 * cooldown of its own. `accountsLocked` marks the body as *our* synthesis rather
 * than a provider verdict — it quotes the provider's text, and a reader that
 * mistakes the quote for fresh evidence will keep renewing a ban from its own echo.
 *
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @param {Object} [opts]
 * @param {boolean} [opts.accountsLocked] - Set when every account was locked for the model
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman, { accountsLocked = false } = {}) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  const body = { error: { message: msg }, retryAfter };
  if (accountsLocked) body.accountsLocked = true;
  return new Response(
    JSON.stringify(body),
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
