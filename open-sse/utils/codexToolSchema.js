// Codex-specific tool JSON Schema compatibility.
//
// `https://chatgpt.com/backend-api/codex/responses` validates every function
// tool's `parameters` with stricter JSON Schema handling than some clients.
// Two provider-specific incompatibilities are handled here:
//
// 1. Unicode property escapes in `pattern` are rejected by Codex's regex engine.
// 2. Numeric JSON Schema keywords represented as strings (for example
//    `minItems: "1"` or `default: "1"` for an integer schema) are rejected by
//    Codex's schema validator even though some clients emit them that way.
//
// Scope guardrail: this is NOT a global schema sanitizer. The normalization runs
// only on the Codex dispatch path so other providers keep the caller's schema
// untouched.

// `\p{...}` / `\P{...}` with an odd number of preceding backslashes — an even
// count means the backslash itself is escaped, so `\\p{Cc}` is a literal "p".
const UNICODE_PROPERTY_ESCAPE = /(^|[^\\])(\\\\)*\\[pP]\{/;

const INTEGER_SCHEMA_KEYWORDS = new Set([
  "minLength", "maxLength",
  "minItems", "maxItems",
  "minProperties", "maxProperties",
  "minContains", "maxContains",
]);

const NUMBER_SCHEMA_KEYWORDS = new Set([
  "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf",
]);

export function hasUnicodePropertyEscape(pattern) {
  return typeof pattern === "string" && UNICODE_PROPERTY_ESCAPE.test(pattern);
}

function numericString(value) {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function normalizeNumericKeyword(key, value) {
  if (!numericString(value)) return value;
  const number = Number(value);
  if (INTEGER_SCHEMA_KEYWORDS.has(key)) return Number.isInteger(number) ? number : value;
  if (NUMBER_SCHEMA_KEYWORDS.has(key)) return number;
  return value;
}

function normalizeTypedDefault(node, value) {
  if (!numericString(value)) return value;
  const type = typeof node?.type === "string" ? node.type.toLowerCase() : "";
  const number = Number(value);
  if (type === "integer") return Number.isInteger(number) ? number : value;
  if (type === "number") return number;
  return value;
}

// Copy-on-write walk: returns the original reference when nothing changed, so
// untouched schemas keep object identity and callers can cheaply detect a no-op.
// `properties` is special-cased because its keys are arbitrary property *names*
// (which may themselves be "pattern" or "properties") and must never be read as
// schema keywords; every other key recurses as an ordinary schema node.
function stripNode(node, stats) {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const cleaned = stripNode(item, stats);
      if (cleaned !== item) changed = true;
      return cleaned;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== "object") return node;

  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "pattern" && hasUnicodePropertyEscape(value)) {
      stats.removed++;
      changed = true;
      continue;
    }

    if (key === "default") {
      const normalized = normalizeTypedDefault(node, value);
      if (normalized !== value) {
        changed = true;
        next[key] = normalized;
        continue;
      }
    }

    if (INTEGER_SCHEMA_KEYWORDS.has(key) || NUMBER_SCHEMA_KEYWORDS.has(key)) {
      const normalized = normalizeNumericKeyword(key, value);
      if (normalized !== value) {
        changed = true;
        next[key] = normalized;
        continue;
      }
    }

    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      let propsChanged = false;
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        const cleaned = stripNode(propSchema, stats);
        if (cleaned !== propSchema) propsChanged = true;
        props[propName] = cleaned;
      }
      if (propsChanged) changed = true;
      next[key] = propsChanged ? props : value;
      continue;
    }

    const cleaned = stripNode(value, stats);
    if (cleaned !== value) changed = true;
    next[key] = cleaned;
  }
  return changed ? next : node;
}

// Remove Codex-incompatible pattern constraints and normalize numeric JSON
// Schema values that Codex requires to be actual numbers.
// Returns the same reference when the schema is already compatible.
export function stripCodexUnsupportedPatterns(schema, stats = { removed: 0 }) {
  return stripNode(schema, stats);
}
