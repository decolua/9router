import { BACKOFF_CONFIG, ERROR_RULES, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";

export const ADAPTIVE_FAILURE_ACTION = Object.freeze({
  TERMINAL: "TERMINAL",
  CREDENTIAL_FAILURE: "CREDENTIAL_FAILURE",
  ACCOUNT_QUOTA_LOCK: "ACCOUNT_QUOTA_LOCK",
  MODEL_QUOTA_LOCK: "MODEL_QUOTA_LOCK",
  POOL_UNFIT: "POOL_UNFIT",
  TRANSIENT_RETRY: "TRANSIENT_RETRY"
});

const MAX_RESET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_RESET_LEAD_MS = 1000;
const MAX_REASON_LENGTH = 256;
const MODEL_LOCK_MAX_MS = 5 * 60 * 1000;
const PROVENANCE_VALUES = new Set(["proxy_connect", "relay_internal", "target_response", "timeout_before_response", "client_abort", "unknown"]);
const POOL_PROVENANCE = new Set(["proxy_connect", "relay_internal", "timeout_before_response"]);
const ACCOUNT_QUOTA_PATTERN = /\b(?:account|project)\b.{0,48}\b(?:quota|usage[ _-]?limit|resource[ _-]?exhausted)\b|\b(?:quota|usage[ _-]?limit|resource[ _-]?exhausted)\b.{0,48}\b(?:account|project)\b/i;
const QUOTA_PATTERN = /quota exceeded|insufficient_quota|usage[ _-]?limit(?: reached| exceeded)?|resource_exhausted|free tier limit|out of credits/i;
const CREDENTIAL_PATTERN = /\b(?:invalid|revoked)\b.{0,24}\b(?:credential|api[ _-]?key|token)\b|\b(?:credential|api[ _-]?key|token)\b.{0,24}\b(?:invalid|revoked)\b/i;
const SENSITIVE_KEY_PATTERN = /(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|cookie|headers?|x-api-key|token|credential|secret)/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'}\]]+/gi;
const SENSITIVE_PATTERN = /\b(?:bearer\s+[A-Za-z0-9_~.+/=-]+|(?:token|authorization|cookie|header|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|credential|secret)\s*[:=]\s*[A-Za-z0-9_~.+/=-]+)/gi;

function sanitizeStructuredValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol" || typeof value === "function") return "[unserializable]";
  if (typeof value !== "object") return "[unserializable]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeStructuredValue(item, seen));
  const sanitized = {};
  try {
    for (const key of Object.keys(value)) {
      sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeStructuredValue(value[key], seen);
    }
  } catch {
    return "[unserializable]";
  }
  return sanitized;
}

function normalizeText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    const serialized = JSON.stringify(sanitizeStructuredValue(value));
    if (typeof serialized === "string") return serialized;
  } catch {}
  try { return String(value); } catch { return ""; }
}

export function sanitizeAdaptiveFailureReason(value) {
  return normalizeText(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(URL_PATTERN, "[redacted-url]").replace(SENSITIVE_PATTERN, "[redacted]").replace(/\s+/g, " ").trim().slice(0, MAX_REASON_LENGTH);
}

function resetExpiry(resetsAtMs, nowMs) {
  const candidates = Array.isArray(resetsAtMs) ? resetsAtMs : [resetsAtMs];
  const trusted = candidates.filter(value => typeof value === "number" && Number.isFinite(value) && value - nowMs > MIN_RESET_LEAD_MS);
  const account = trusted.filter(value => value - nowMs <= MAX_RESET_WINDOW_MS);
  return { accountExpiry: account.length ? Math.max(...account) : null, modelExpiry: trusted.length ? Math.min(Math.max(...trusted), nowMs + MAX_RESET_WINDOW_MS) : null };
}

function fallbackCooldown(error, status) {
  const text = normalizeText(error).toLowerCase();
  for (const rule of ERROR_RULES) if ((rule.text && text.includes(rule.text)) || rule.status === status) return rule.backoff ? BACKOFF_CONFIG.base : rule.cooldownMs;
  return TRANSIENT_COOLDOWN_MS;
}

function isRetryable(error, status) {
  const text = normalizeText(error).toLowerCase();
  return /timeout|timed out/.test(text) || ERROR_RULES.some(rule => (rule.text && text.includes(rule.text)) || rule.status === status);
}

function result(action, input, expiresAtMs = null, poolScoped = null) {
  return { action, lockScope: action === ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK ? "account" : action === ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK ? "model" : null, expiresAtMs, reason: sanitizeAdaptiveFailureReason(input.error), source: PROVENANCE_VALUES.has(input.provenance) ? input.provenance : "unknown", poolScoped };
}

export function classifyAdaptiveFailure(input, nowMs = Date.now()) {
  const facts = input || {};
  const error = normalizeText(facts.error);
  const resets = resetExpiry(facts.resetsAtMs, nowMs);
  if (facts.provenance === "client_abort") return result(ADAPTIVE_FAILURE_ACTION.TERMINAL, facts);
  if (facts.status === 401 || CREDENTIAL_PATTERN.test(error)) return result(ADAPTIVE_FAILURE_ACTION.CREDENTIAL_FAILURE, facts);
  if (ACCOUNT_QUOTA_PATTERN.test(error) && resets.accountExpiry) return result(ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK, facts, resets.accountExpiry);
  if (QUOTA_PATTERN.test(error)) return result(ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, facts, resets.modelExpiry || nowMs + Math.min(fallbackCooldown(error, facts.status), MODEL_LOCK_MAX_MS));
  if (typeof facts.selectedPoolId === "string" && facts.selectedPoolId && POOL_PROVENANCE.has(facts.provenance)) return result(ADAPTIVE_FAILURE_ACTION.POOL_UNFIT, facts, null, { poolId: facts.selectedPoolId });
  if (isRetryable(error, facts.status)) return result(ADAPTIVE_FAILURE_ACTION.TRANSIENT_RETRY, facts);
  return result(ADAPTIVE_FAILURE_ACTION.TERMINAL, facts);
}
