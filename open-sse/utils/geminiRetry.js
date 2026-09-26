import { GEMINI_RETRY } from "../config/errorConfig.js";

const RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo";

// "22s" | "22.23s" | "500ms" | "2m" | "1.5h" | "1d" → ms (null when unparseable)
export function parseRetryDelayToMs(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^([\d.]+)\s*(ms|s|m|h|d)$/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = m[2].toLowerCase();
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  const ms = Math.round(value * factor);
  return Number.isSafeInteger(ms) ? ms : null;
}

function retryDelayFromDetails(details) {
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    if (d?.["@type"] === RETRY_INFO_TYPE && d?.retryDelay != null) {
      const ms = parseRetryDelayToMs(d.retryDelay);
      if (ms != null) return ms;
    }
  }
  return null;
}

// Extract Google 429 cooldown from a Gemini error body/message.
// Prefers details[].RetryInfo.retryDelay, falls back to "Please retry in Xs".
// Returns ms, or null when the body carries no usable hint.
export function parseGeminiRetryDelayMs(bodyText) {
  if (!bodyText) return null;
  const text = typeof bodyText === "string" ? bodyText : JSON.stringify(bodyText);
  try {
    const parsed = JSON.parse(text);
    const details = parsed?.error?.details;
    const fromDetails = retryDelayFromDetails(details);
    if (fromDetails != null) return fromDetails;
    const message = parsed?.error?.message;
    if (typeof message === "string") {
      const m = message.match(/please retry in\s+([\d.]+\s*(?:ms|s|m|h|d))/i);
      if (m) {
        const ms = parseRetryDelayToMs(m[1]);
        if (ms != null) return ms;
      }
    }
  } catch {
    // not JSON — try raw-text patterns below
  }
  const rawDelay = text.match(/"retryDelay"\s*:\s*"([^"]+)"/)?.[1];
  if (rawDelay) {
    const ms = parseRetryDelayToMs(rawDelay);
    if (ms != null) return ms;
  }
  const retryIn = text.match(/please retry in\s+([\d.]+\s*(?:ms|s|m|h|d))/i)?.[1];
  if (retryIn) {
    const ms = parseRetryDelayToMs(retryIn);
    if (ms != null) return ms;
  }
  return null;
}

// Random 1-3h park for Gemini 429s with no upstream hint (exhausted free key).
// Uses Math.random — no crypto needed for a cooldown jitter.
export function randomGeminiNoHintCooldownMs() {
  const { noHintMinMs, noHintMaxMs } = GEMINI_RETRY;
  return noHintMinMs + Math.floor(Math.random() * (noHintMaxMs - noHintMinMs));
}

const QUOTA_FAILURE_TYPE = "type.googleapis.com/google.rpc.QuotaFailure";

// True when the 429 body reports a *daily* quota violation
// (quotaId like "...PerDay..."). Daily exhaustion won't clear when the
// seconds-scale RetryInfo delay expires, so the key needs an hours-scale park.
export function hasDailyQuotaViolation(bodyText) {
  if (!bodyText) return false;
  const text = typeof bodyText === "string" ? bodyText : JSON.stringify(bodyText);
  try {
    const parsed = JSON.parse(text);
    const details = parsed?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (d?.["@type"] !== QUOTA_FAILURE_TYPE) continue;
        const violations = Array.isArray(d?.violations) ? d.violations : [];
        if (violations.some((v) => String(v?.quotaId || "").toLowerCase().includes("perday"))) {
          return true;
        }
      }
      return false;
    }
  } catch {
    // not JSON — try raw-text pattern below
  }
  return /"quotaId"\s*:\s*"[^"]*perday[^"]*"/i.test(text);
}

// Full Gemini 429 cooldown policy in one place: daily exhaustion (or no hint
// at all) parks the key 1-3h; pure per-minute rate limiting honors RetryInfo.
export function resolveGeminiCooldownMs(bodyText) {
  if (hasDailyQuotaViolation(bodyText)) return randomGeminiNoHintCooldownMs();
  return parseGeminiRetryDelayMs(bodyText) ?? randomGeminiNoHintCooldownMs();
}
