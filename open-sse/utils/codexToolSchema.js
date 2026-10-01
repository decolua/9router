// Codex-specific tool JSON Schema compatibility.
//
// `https://chatgpt.com/backend-api/codex/responses` validates every function
// tool's `parameters` with a regex engine that does not implement Unicode
// property escapes. A `pattern` such as
//
//   "^(?!__.*__$)[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\"\\\\./\\[\\]]{1,200}$"
//
// is a perfectly valid ECMAScript `u`-mode regex, but Codex answers
//
//   400 Invalid schema for function 'Artifact': '^\p{Cc}...' is not a 'regex'
//   param: tools[0].parameters
//
// The request is deterministically malformed for this provider, so every
// account fails identically and the combo pays a full failover before landing
// somewhere that accepts it (#3922).
//
// Scope guardrail (#3667): this is NOT a global schema sanitizer. Providers
// that do support `\p{...}` keep the constraint untouched — the strip runs only
// on the Codex dispatch path, and only on `pattern` strings that actually
// contain a property escape. Everything else in the schema (including valid
// patterns) passes through byte-identical.

// `\p{...}` / `\P{...}` with an odd number of preceding backslashes — an even
// count means the backslash itself is escaped, so `\\p{Cc}` is a literal "p".
const UNICODE_PROPERTY_ESCAPE = /(^|[^\\])(\\\\)*\\[pP]\{/;

export function hasUnicodePropertyEscape(pattern) {
  return typeof pattern === "string" && UNICODE_PROPERTY_ESCAPE.test(pattern);
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

// Remove only the `pattern` constraints Codex's validator rejects.
// Returns the same reference when the schema is already compatible.
export function stripCodexUnsupportedPatterns(schema, stats = { removed: 0 }) {
  return stripNode(schema, stats);
}

// ---------------------------------------------------------------------------
// Shape coercion: legal JSON Schema that is not a valid Schema *object*.
//
// OpenAI's Responses validator walks every function tool's `parameters` and
// requires each property value to be a Schema object. Real MCP tool servers
// emit two shapes that violate this, and one offending parameter fails the
// whole request on every account:
//
//   400 Invalid schema for function 'X': 'object' is not of type 'object', 'boolean'
//   param: tools[71].parameters
//
//   properties: { value: "object" }        — the type name where a Schema belongs
//   items: [{...}, {...}]                  — tuple validation; `items` must be one Schema
//
// Same scope guardrail as stripCodexUnsupportedPatterns: this runs only on the
// Codex dispatch path, and returns the original reference when nothing changed.

// Primitive type names; anything unrecognised degrades to a string (not a
// rejection — the parameter stays usable).
const JSON_SCHEMA_TYPES = new Set([
  "string", "number", "integer", "boolean", "array", "object", "null"
]);

function isSchemaObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFromTypeHint(value) {
  const hint = typeof value === "string" ? value.trim() : "";
  return { type: JSON_SCHEMA_TYPES.has(hint) ? hint : "string" };
}

// Codex cannot express tuples either — keep the most informative member.
// Mirrors the Antigravity translator's selectBest() scoring.
function selectBestVariant(variants) {
  let best = variants[0];
  let bestScore = -1;
  for (const item of variants) {
    let score = 0;
    if (item.type === "object" || item.properties) score = 3;
    else if (item.type === "array" || item.items) score = 2;
    else if (item.type && item.type !== "null") score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function coerceNode(node) {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const coerced = coerceNode(item);
      if (coerced !== item) changed = true;
      return coerced;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== "object") return node;

  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "items") {
      if (Array.isArray(value)) {
        const variants = value.filter(isSchemaObject);
        changed = true;
        if (variants.length > 0) next[key] = coerceNode(selectBestVariant(variants));
        continue;
      }
      if (typeof value === "string") {
        changed = true;
        next[key] = schemaFromTypeHint(value);
        continue;
      }
    }
    // Property names are arbitrary data (a tool may declare a `properties`
    // parameter), so they must never be read as schema keywords.
    if (key === "properties" && isSchemaObject(value)) {
      let propsChanged = false;
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        const coerced = isSchemaObject(propSchema)
          ? coerceNode(propSchema)
          : schemaFromTypeHint(propSchema);
        if (coerced !== propSchema) propsChanged = true;
        props[propName] = coerced;
      }
      if (propsChanged) changed = true;
      next[key] = propsChanged ? props : value;
      continue;
    }
    const coerced = coerceNode(value);
    if (coerced !== value) changed = true;
    next[key] = coerced;
  }
  return changed ? next : node;
}

// Coerce schema shapes the Codex Responses validator rejects.
// Returns the same reference when the schema is already compatible.
export function coerceCodexSchemaShapes(schema) {
  return coerceNode(schema);
}
