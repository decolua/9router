const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_ENTRIES = 50;
const MAX_STRING_LENGTH = 1024;
const MAX_DEPTH = 6;

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const CIRCULAR = "[CIRCULAR]";
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|api[-_]?key|access[-_]?key|access[-_]?token|private[-_]?key|providerSpecificData)|(?:^|[-_])token(?:$|[-_])/i;
const SECRET_VALUE = /\b(?:bearer|basic)\s+\S+|\b(?:sk|pk|rk|ghp|xox[abprs])[-_][A-Za-z0-9._~+/=:-]+|(?:api[-_]?key|access[-_]?token|auth[-_]?token|password|secret)\s*[:=]\s*\S+/i;
const CREDENTIAL_URL = /https?:\/\/[^/\s:@]+:[^/\s@]+@|https?:\/\/\S+[?&](?:token|access_token|api_key|apikey|key|secret|password)=/i;

function sanitizeString(value) {
  if (SECRET_VALUE.test(value) || CREDENTIAL_URL.test(value)) return REDACTED;

  const cleaned = value.replace(CONTROL_CHARACTERS, " ");
  if (cleaned.length <= MAX_STRING_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_STRING_LENGTH - 3)}...`;
}

function sanitizeValue(value, depth, seen) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null;
  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_DEPTH) return TRUNCATED;

  seen.add(value);
  if (Array.isArray(value)) {
    const limitedItems = value.slice(0, MAX_ARRAY_ITEMS - 1).map((item) => sanitizeValue(item, depth + 1, seen));
    if (value.length >= MAX_ARRAY_ITEMS) limitedItems.push(TRUNCATED);
    seen.delete(value);
    return limitedItems;
  }

  const output = {};
  const entries = Object.entries(value);
  for (const [key, item] of entries.slice(0, MAX_OBJECT_ENTRIES - 1)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(item, depth + 1, seen);
  }
  if (entries.length >= MAX_OBJECT_ENTRIES) output._truncated = TRUNCATED;
  seen.delete(value);
  return output;
}

export function sanitizePlaygroundData(value) {
  return sanitizeValue(value, 0, new WeakSet());
}

export const SANITIZE_LIMITS = Object.freeze({
  maxArrayItems: MAX_ARRAY_ITEMS,
  maxObjectEntries: MAX_OBJECT_ENTRIES,
  maxStringLength: MAX_STRING_LENGTH,
  maxDepth: MAX_DEPTH,
});
