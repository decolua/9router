import crypto from "node:crypto";

const CHARSETS = {
  lalpha: "abcdefghijklmnopqrstuvwxyz",
  ualpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ralpha: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  num: "0123456789",
  symbol: "-._~",
};

const MAX_LENGTH = 256;
const MAX_REF_DEPTH = 20;

// Uniform random int in [0, max) via rejection sampling (no modulo bias).
function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % max;
}

// --- opencode session id --------------------------------------------------
// Mirrors anomalyco/opencode's Identifier: create("ses", "descending").
// Format: "ses_" + 12 hex (descending-encoded Date.now()*0x1000 + counter,
// 6 big-endian bytes) + 14 base62 random chars = "ses_" + 26 chars.
// Ref: packages/opencode/src/id/id.ts (LENGTH = 26, prefix session = "ses").
const OPENCODE_ID_LENGTH = 26;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Module-local monotonic counter (matches opencode's per-timestamp counter).
let ocLastTimestamp = 0;
let ocCounter = 0;

function randomBase62(length) {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) result += BASE62[bytes[i] % 62];
  return result;
}

// Generate a fresh opencode-style session id ("ses_...").
export function generateOpencodeSessionId(timestamp = Date.now()) {
  if (timestamp !== ocLastTimestamp) {
    ocLastTimestamp = timestamp;
    ocCounter = 0;
  }
  ocCounter++;

  // descending direction: bit-inverted, so newer ids sort first
  let now = BigInt(timestamp) * BigInt(0x1000) + BigInt(ocCounter);
  now = ~now;

  const timeBytes = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
  }

  return "ses_" + timeBytes.toString("hex") + randomBase62(OPENCODE_ID_LENGTH - 12);
}

// Special standalone tokens: exact-match only, not combinable, no length param.
const SPECIAL_TOKENS = {
  opencode_session: () => generateOpencodeSessionId(),
};

// Resolve one {charset[_charset...][:length]} token → string, or null if invalid.
function resolveDynamicToken(inner, random) {
  const [charsetPart, lengthPart] = inner.split(":");
  const names = charsetPart.split("_");
  let pool = "";
  for (const n of names) {
    const set = CHARSETS[n];
    if (!set) return null; // unknown charset → leave literal
    pool += set;
  }
  let length = 1;
  if (lengthPart !== undefined) {
    if (!/^\d+$/.test(lengthPart)) return null;
    length = parseInt(lengthPart, 10);
    if (length < 1 || length > MAX_LENGTH) return null;
  }
  let out = "";
  for (let i = 0; i < length; i++) out += pool[random(pool.length)];
  return out;
}

// Resolve ONLY dynamic tags in a string. Header refs left untouched.
export function resolveTemplateValue(value, opts = {}) {
  if (typeof value !== "string") return "";
  const random = opts.random || secureRandomInt;
  return value.replace(/\{([^{}:]+(?::\d+)?)\}/g, (match, inner) => {
    if (inner.startsWith("header:")) return match; // header ref handled later
    // Special standalone tokens (exact match, not combinable, no length).
    const special = SPECIAL_TOKENS[inner];
    if (special) return special();
    const resolved = resolveDynamicToken(inner, random);
    return resolved === null ? match : resolved;
  });
}

// Resolve {header:Name} refs against a resolved-value map (case-insensitive).
function resolveRefs(value, lowerMap, depth) {
  if (depth > MAX_REF_DEPTH) return value.replace(/\{header:[^{}]+\}/g, "");
  return value.replace(/\{header:([^{}]+)\}/g, (_m, name) => {
    const target = lowerMap[name.trim().toLowerCase()];
    if (target === undefined) return "";
    return resolveRefs(target, lowerMap, depth + 1);
  });
}

// Sentinel emitted for a header whose value is the {remove} directive.
// Consumers (buildHeaders) must delete the header and NOT send it.
export const REMOVE_HEADER = "\u0000__9R_REMOVE__";

export function resolveCustomHeaders(customHeaders, { resolveValue } = {}) {
  if (!Array.isArray(customHeaders)) return {};

  // Dedup by case-insensitive name, last wins; skip empty names.
  const byLower = new Map(); // lowerName → {name, value}
  for (const h of customHeaders) {
    if (!h || typeof h.name !== "string") continue;
    const name = h.name.trim();
    if (!name) continue;
    byLower.set(name.toLowerCase(), { name, value: typeof h.value === "string" ? h.value : "" });
  }

  // Pass 1: resolve dynamic tags once per header. The {remove} directive is
  // detected on the RAW (trimmed) value and short-circuits to the sentinel.
  const pass1 = [];
  const lowerMap = {};
  for (const { name, value } of byLower.values()) {
    if (value.trim() === "{remove}") {
      pass1.push({ name, value: REMOVE_HEADER });
      lowerMap[name.toLowerCase()] = ""; // a {header:...} ref to a removed header → ""
      continue;
    }
    const defaultResolve = () => resolveTemplateValue(value);
    const resolved = resolveValue ? resolveValue(name, value, defaultResolve) : defaultResolve();
    pass1.push({ name, value: resolved });
    lowerMap[name.toLowerCase()] = resolved;
  }

  // Pass 2: resolve {header:Name} refs against pass-1 values.
  const out = {};
  for (const { name, value } of pass1) {
    out[name] = value === REMOVE_HEADER ? REMOVE_HEADER : resolveRefs(value, lowerMap, 0).replace(/[\r\n]/g, "");
  }
  return out;
}
