// Codex-specific tool JSON Schema compatibility.
//
// `https://chatgpt.com/backend-api/codex/responses` rejects certain valid JSON
// Schema keywords/patterns:
// - `pattern` values using Unicode property escapes (`\p{...}` / `\P{...}`),
//   which fail Codex's regex engine with 400 Invalid schema ... is not a 'regex'
// - `uniqueItems`, which Codex's schema validator rejects
//
// The request is deterministically malformed for this provider, so every
// account fails identically and the combo pays a full failover before landing
// somewhere that accepts it (#3922).
//
// Scope guardrail (#3667): this is NOT a global schema sanitizer. Providers
// that support these constraints keep them untouched — the strip runs only on
// the Codex dispatch path, removing only `pattern` strings containing Unicode
// property escapes and `uniqueItems`. Everything else in the schema (including
// valid patterns, `default`/`enum` data, and map keys) passes through unchanged.

// `\p{...}` / `\P{...}` with an odd number of preceding backslashes — an even
// count means the backslash itself is escaped, so `\\p{Cc}` is a literal "p".
const UNICODE_PROPERTY_ESCAPE = /(^|[^\\])(\\\\)*\\[pP]\{/;

export function hasUnicodePropertyEscape(pattern) {
  return typeof pattern === "string" && UNICODE_PROPERTY_ESCAPE.test(pattern);
}

// Copy-on-write walk: returns the original reference when nothing changed, so
// untouched schemas keep object identity and callers can cheaply detect a no-op.
// `properties`, `$defs`, and `definitions` are schema maps whose keys are
// arbitrary names (which may themselves be "pattern" or "uniqueItems") and must
// not be read as schema keywords; `default` and `enum` hold literal data and are
// preserved verbatim without recursion. Every other key recurses as a schema node.
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
    if ((key === "pattern" && hasUnicodePropertyEscape(value)) || key === "uniqueItems") {
      stats.removed++;
      changed = true;
      continue;
    }
    if ((key === "properties" || key === "$defs" || key === "definitions") && value && typeof value === "object" && !Array.isArray(value)) {
      let mapChanged = false;
      const mapped = {};
      for (const [entryKey, entrySchema] of Object.entries(value)) {
        const cleaned = stripNode(entrySchema, stats);
        if (cleaned !== entrySchema) mapChanged = true;
        mapped[entryKey] = cleaned;
      }
      if (mapChanged) changed = true;
      next[key] = mapChanged ? mapped : value;
      continue;
    }
    if (key === "default" || key === "enum") {
      next[key] = value;
      continue;
    }
    const cleaned = stripNode(value, stats);
    if (cleaned !== value) changed = true;
    next[key] = cleaned;
  }
  return changed ? next : node;
}

// Remove only the unsupported `pattern` (`\p{...}`) and `uniqueItems`
// constraints Codex's validator rejects, while preserving schema maps and data.
// Returns the same reference when the schema is already compatible.
export function stripCodexUnsupportedPatterns(schema, stats = { removed: 0 }) {
  return stripNode(schema, stats);
}
