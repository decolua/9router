// Custom outbound headers for OpenAI/Anthropic Compatible provider nodes.
//
// Stored on the provider node as an ordered list: [{ name, value }].
// - Save time: normalizeCustomHeaders / resolveCustomHeadersForSave validate and
//   reject the request (400) on any invalid entry.
// - Apply time: applyCustomHeaders re-validates every entry and silently skips
//   anything invalid or denylisted (defense in depth against tampered storage).
// - Responses: maskCustomHeaders never returns a stored value.
import {
  CUSTOM_HEADER_PROVIDER_PREFIXES,
  CUSTOM_HEADERS_MAX_COUNT,
  CUSTOM_HEADER_NAME_MAX_LENGTH,
  CUSTOM_HEADER_VALUE_MAX_LENGTH,
  CUSTOM_HEADER_NAME_RE,
  CUSTOM_HEADER_API_KEY_PLACEHOLDER,
  CUSTOM_HEADER_MASK,
  CUSTOM_HEADER_DENYLIST,
} from "../config/customHeaders.js";

// CR, LF, NUL, or anything outside Latin-1 (fetch/undici only accepts ByteStrings).
const INVALID_VALUE_RE = /[\r\n\0]|[^\u0000-\u00ff]/;

export function supportsCustomHeaders(provider) {
  return typeof provider === "string"
    && CUSTOM_HEADER_PROVIDER_PREFIXES.some((prefix) => provider.startsWith(prefix));
}

export function isDenylistedHeader(name) {
  return CUSTOM_HEADER_DENYLIST.has(String(name).toLowerCase());
}

// Per-entry check shared by save- and apply-time. Returns an error string or null.
export function validateCustomHeader(name, value) {
  if (typeof name !== "string" || !name) return "Header name is required";
  if (name.length > CUSTOM_HEADER_NAME_MAX_LENGTH) return `Header name too long (max ${CUSTOM_HEADER_NAME_MAX_LENGTH})`;
  if (!CUSTOM_HEADER_NAME_RE.test(name)) return `Invalid header name: ${name}`;
  if (isDenylistedHeader(name)) return `Header ${name} cannot be set`;
  if (typeof value !== "string") return `Invalid value for header ${name}`;
  if (value.length > CUSTOM_HEADER_VALUE_MAX_LENGTH) return `Header ${name} value too long (max ${CUSTOM_HEADER_VALUE_MAX_LENGTH})`;
  if (INVALID_VALUE_RE.test(value)) return `Invalid value for header ${name} (no line breaks, NUL or non-Latin-1 characters)`;
  return null;
}

// Accepts [{name, value}] (canonical) or a plain { name: value } object.
function toEntries(input) {
  if (Array.isArray(input)) {
    return input.map((e) => (e && typeof e === "object" ? { name: e.name, value: e.value } : { name: e, value: undefined }));
  }
  if (input && typeof input === "object") {
    return Object.entries(input).map(([name, value]) => ({ name, value }));
  }
  return null;
}

/**
 * Validate + normalize user input. Rows with a blank name are dropped (empty UI rows).
 * Names are trimmed; values are kept verbatim except surrounding whitespace.
 * @returns {{ headers: Array<{name:string,value:string}> } | { error: string }}
 */
export function normalizeCustomHeaders(input) {
  if (input === undefined || input === null || input === "") return { headers: [] };
  const entries = toEntries(input);
  if (!entries) return { error: "customHeaders must be a list of { name, value }" };

  const headers = [];
  const seen = new Set();
  for (const entry of entries) {
    const name = typeof entry.name === "string" ? entry.name.trim() : entry.name;
    if (name === "" || name === undefined || name === null) continue;
    const value = entry.value === undefined || entry.value === null
      ? ""
      : (typeof entry.value === "string" ? entry.value.trim() : entry.value);
    const error = validateCustomHeader(name, value);
    if (error) return { error };
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `Duplicate header name: ${name}` };
    seen.add(key);
    headers.push({ name, value });
  }
  if (headers.length > CUSTOM_HEADERS_MAX_COUNT) {
    return { error: `Too many custom headers (max ${CUSTOM_HEADERS_MAX_COUNT})` };
  }
  return { headers };
}

/**
 * Edit rule: an incoming entry whose value is exactly CUSTOM_HEADER_MASK keeps the
 * stored value for the same (case-insensitive) name. A mask with no stored value
 * for that name is an error (the user renamed a header without re-entering it).
 * `incoming === undefined` means "field not sent" → keep the stored list as-is.
 */
export function resolveCustomHeadersForSave(incoming, stored = []) {
  if (incoming === undefined) return { headers: Array.isArray(stored) ? stored : [] };
  const entries = toEntries(incoming);
  if (!entries) return normalizeCustomHeaders(incoming);

  const storedByName = new Map(
    (Array.isArray(stored) ? stored : [])
      .filter((e) => e && typeof e.name === "string")
      .map((e) => [e.name.toLowerCase(), e.value]),
  );
  const resolved = [];
  for (const entry of entries) {
    if (entry.value === CUSTOM_HEADER_MASK) {
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) continue;
      const keep = storedByName.get(name.toLowerCase());
      if (typeof keep !== "string") return { error: `Re-enter the value for header ${name}` };
      resolved.push({ name, value: keep });
    } else {
      resolved.push(entry);
    }
  }
  return normalizeCustomHeaders(resolved);
}

// API-response form: names kept, non-empty values replaced by the mask sentinel.
// Empty values are not secret and carry meaning ("remove this header").
export function maskCustomHeaders(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.name === "string")
    .map((e) => ({ name: e.name, value: e.value ? CUSTOM_HEADER_MASK : "" }));
}

// Node object with customHeaders masked — use for every API response returning a node.
export function toMaskedNode(node) {
  if (!node || !Array.isArray(node.customHeaders)) return node;
  return { ...node, customHeaders: maskCustomHeaders(node.customHeaders) };
}

function deleteHeaderCaseInsensitive(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

/**
 * Apply a header list onto an outbound headers object (mutates + returns it).
 * Last-wins, case-insensitive replace; `{{API_KEY}}` → connection API key;
 * empty value removes the header. Callers must already have checked that the
 * target is a compatible node — prefer applyCustomHeaders when a provider id exists.
 */
export function applyHeaderList(headers, list, credentials) {
  if (!headers || !Array.isArray(list) || list.length === 0) return headers;
  const apiKey = credentials?.apiKey || credentials?.accessToken || "";
  let applied = 0;
  for (const entry of list) {
    if (applied >= CUSTOM_HEADERS_MAX_COUNT) break;
    if (!entry || typeof entry.name !== "string") continue;
    const name = entry.name.trim();
    if (validateCustomHeader(name, entry.value)) continue;
    const value = entry.value.split(CUSTOM_HEADER_API_KEY_PLACEHOLDER).join(apiKey).trim();
    // the substituted key itself must also be a safe header value
    if (INVALID_VALUE_RE.test(value)) continue;
    applied++;
    deleteHeaderCaseInsensitive(headers, name);
    if (value) headers[name] = value;
  }
  return headers;
}

// Provider-gated apply: no-op for anything but openai-/anthropic-compatible nodes,
// even if `list` somehow reaches a built-in provider's credentials.
export function applyCustomHeaders(headers, list, credentials, provider) {
  if (!supportsCustomHeaders(provider)) return headers;
  return applyHeaderList(headers, list, credentials);
}

// Copy of `headers` with every custom header name's value masked — for logs.
export function maskCustomHeaderValues(headers, list) {
  if (!headers || !Array.isArray(list) || list.length === 0) return headers;
  const names = new Set(list.filter((e) => e && typeof e.name === "string").map((e) => e.name.trim().toLowerCase()));
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (names.has(key.toLowerCase())) out[key] = CUSTOM_HEADER_MASK;
  }
  return out;
}
