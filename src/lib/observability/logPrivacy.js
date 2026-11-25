import { ERROR_CATEGORY } from "../../../open-sse/config/inferenceErrors.js";

const MASK = "[REDACTED]";
const secretName = /authorization|cookie|api[-_]?key|token|password|secret|private[-_]?key/i;
const secretValue = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\bBearer\s+[^\s"',;}]+|\bsk-[\w-]+|\bAIza[\w-]+|\b(?:eyJ[\w-]*|[\w-]{8,})\.[\w-]+\.[\w-]{3,}/gi;
// Credentials also occur in URLs, upstream error strings and serialized tool arguments.
const assignment = /(?<![\w-])(["']?(?:[\w-]{0,64}(?:authorization|cookie|api[-_]?key|token|password|secret|private[-_]?key))["']?[ \t]*[:=][ \t]*)[^\r\n]+/gi;

export function redactLogValue(value, depth = 0) {
  if (depth > 48) return MASK;
  if (typeof value === "string") {
    if (/^\s*[[{]/.test(value)) {
      try { return JSON.stringify(redactLogValue(JSON.parse(value), depth + 1)); } catch { /* free text */ }
    }
    return value.replace(secretValue, MASK).replace(assignment, "$1" + MASK);
  }
  if (Array.isArray(value)) {
    // Headers may also arrive as [name, value] pairs.
    if (value.length === 2 && typeof value[0] === "string" && secretName.test(value[0]) && /^[\w-]+$/.test(value[0]))
      return [value[0].replace(secretValue, MASK), MASK];
    return value.map(v => redactLogValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = value instanceof Headers ? value.entries() : Object.entries(value);
    return Object.fromEntries(Array.from(entries, ([key, v]) => [
      key.replace(secretValue, MASK), secretName.test(key) ? MASK : redactLogValue(v, depth + 1),
    ]));
  }
  return value;
}

export const BODY_FIELDS = ["request", "providerRequest", "providerResponse", "response"];
const tokenFields = ["prompt_tokens", "completion_tokens", "input_tokens", "output_tokens", "cached_tokens",
  "cache_read_input_tokens", "cache_creation_input_tokens", "reasoning_tokens", "total_tokens"];
const numbers = (obj, keys) => Object.fromEntries(keys.filter(k => Number.isFinite(obj?.[k])).map(k => [k, obj[k]]));
const label = v => typeof v === "string" ? redactLogValue(v).slice(0, 512) : null;
export function detailMetadata(item) {
  return {
    id: label(item.id), timestamp: item.timestamp, provider: label(item.provider), model: label(item.model),
    connectionId: label(item.connectionId), status: label(item.status), latency: numbers(item.latency, ["ttft", "total"]),
    tokens: numbers(item.tokens, tokenFields),
    errorCategory: Object.values(ERROR_CATEGORY).includes(item.errorCategory) ? item.errorCategory : item.status === "error" ? "unknown" : null,
  };
}

export function redactDetails(details) {
  return (details || []).map(d => {
    const safe = { ...d };
    for (const key of BODY_FIELDS) if (safe[key] !== undefined) safe[key] = { redacted: true };
    return safe;
  });
}
