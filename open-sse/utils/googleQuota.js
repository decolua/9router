/**
 * Extract the precise quota reset moment from a Google Cloud Code Assist error body.
 *
 * Both antigravity and gemini-cli talk to cloudcode-pa.googleapis.com, which reports
 * exactly when an exhausted quota comes back. A real 429 body looks like:
 *
 *   { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED",
 *       "message": "Individual quota reached. ... Resets in 149h50m20s.",
 *       "details": [
 *         { "@type": ".../google.rpc.ErrorInfo", "reason": "QUOTA_EXHAUSTED",
 *           "metadata": { "quotaResetDelay": "149h50m20.179078308s",
 *                         "quotaResetTimeStamp": "2026-08-08T17:54:07Z" } },
 *         { "@type": ".../google.rpc.RetryInfo", "retryDelay": "539420.179078308s" } ] } }
 *
 * Preference order: absolute timestamp, then quota delay, then RetryInfo delay.
 */

const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";
const RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo";

/**
 * Parse a duration string into milliseconds.
 * Handles protobuf Duration JSON ("539420.179078308s") and Go's unit form
 * ("149h50m20.179078308s"). Returns null when nothing parses.
 * @param {string} value
 * @returns {number|null}
 */
export function parseDurationMs(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  // Protobuf Duration JSON: a bare seconds value with an "s" suffix.
  if (/^\d+(\.\d+)?s$/.test(text)) {
    return Math.round(parseFloat(text) * 1000);
  }

  // Go duration: any combination of h / m / s parts.
  const parts = text.match(/(\d+(?:\.\d+)?)(h|m|s|ms)/g);
  if (!parts) return null;
  const unitMs = { h: 3600000, m: 60000, s: 1000, ms: 1 };
  let total = 0;
  for (const part of parts) {
    const [, num, unit] = part.match(/(\d+(?:\.\d+)?)(h|m|s|ms)/);
    total += parseFloat(num) * unitMs[unit];
  }
  return Math.round(total);
}

/**
 * Pull the quota reset moment out of a Google API error body.
 * @param {string|object} body - Raw response text or already-parsed JSON
 * @param {number} [now] - Epoch ms to resolve relative delays against
 * @returns {{ resetsAtMs: number|null, reason: string|null, model: string|null, retryAfter: string|null }}
 */
export function parseGoogleQuotaReset(body, now = Date.now()) {
  const empty = { resetsAtMs: null, reason: null, model: null, retryAfter: null };
  if (!body) return empty;

  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return empty;
    }
  }

  const details = parsed?.error?.details;
  if (!Array.isArray(details)) return empty;

  let resetsAtMs = null;
  let reason = null;
  let model = null;
  let retryAfter = null;

  for (const detail of details) {
    if (detail?.["@type"] === ERROR_INFO_TYPE) {
      reason = detail.reason || reason;
      model = detail.metadata?.model || model;

      const stamp = detail.metadata?.quotaResetTimeStamp;
      if (!resetsAtMs && stamp) {
        const ms = new Date(stamp).getTime();
        if (Number.isFinite(ms) && ms > now) resetsAtMs = ms;
      }

      if (!resetsAtMs) {
        const delayMs = parseDurationMs(detail.metadata?.quotaResetDelay);
        if (delayMs > 0) resetsAtMs = now + delayMs;
      }
    } else if (detail?.["@type"] === RETRY_INFO_TYPE && detail?.retryDelay) {
      retryAfter = detail.retryDelay;
    }
  }

  // RetryInfo is the last resort: it repeats the quota delay when a quota is spent,
  // but is also present on short server-side throttles.
  if (!resetsAtMs && retryAfter) {
    const delayMs = parseDurationMs(retryAfter);
    if (delayMs > 0) resetsAtMs = now + delayMs;
  }

  return { resetsAtMs, reason, model, retryAfter };
}
