// Allowed-model pattern language, in one place.
//
// Three consumers must agree on what a key's allowedModels list admits: the
// request gate, the /v1/models listing, and the usage dashboards. Kept free of
// imports so every one of them — and the self-check — can use it without
// dragging in the database driver.

/**
 * Allowed-model patterns of a key, or null when the key may use every model.
 * One definition for both the request gate and the /v1/models listing, so a key
 * can never see a model it would be refused at request time.
 */
export function parseAllowedModels(allowedModels) {
  const raw = String(allowedModels ?? "").trim();
  if (!raw || raw === "*") return null;
  const patterns = raw.split(",").map((model) => model.trim().toLowerCase()).filter(Boolean);
  return patterns.length ? patterns : null;
}

/** Exact, `prefix*` and `*suffix` patterns, matched case-insensitively. */
export function matchesAllowedModels(patterns, requestedModel) {
  if (!patterns) return true;
  const req = String(requestedModel || "").trim().toLowerCase();
  if (!req) return false;
  return patterns.some((allowed) => {
    if (allowed === "*" || allowed === req) return true;
    if (allowed.endsWith("*")) return req.startsWith(allowed.slice(0, -1));
    if (allowed.startsWith("*")) return req.endsWith(allowed.slice(1));
    return false;
  });
}

/**
 * Same pattern language as matchesAllowedModels, expressed as a SQL condition so
 * row counts stay correct under pagination. Returns null when every model is
 * allowed, which lets the caller skip the WHERE clause entirely.
 */
export function buildAllowedModelsSql(patterns, column = "model") {
  if (!patterns) return null;
  const clauses = [];
  const params = [];
  for (const allowed of patterns) {
    if (allowed === "*") return null;
    if (allowed.endsWith("*")) {
      clauses.push(`${column} LIKE ?`);
      params.push(`${allowed.slice(0, -1)}%`);
    } else if (allowed.startsWith("*")) {
      clauses.push(`${column} LIKE ?`);
      params.push(`%${allowed.slice(1)}`);
    } else {
      clauses.push(`${column} = ?`);
      params.push(allowed);
    }
  }
  if (clauses.length === 0) return { sql: "1 = 0", params };
  return { sql: `(${clauses.join(" OR ")})`, params };
}

/**
 * Fold a model deletion or rename into one key's allowlist.
 *
 * Only the ids the caller says are gone or renamed are touched. A wildcard
 * pattern tracks future models by design, so it is never pruned, and an id this
 * function was not told about is left alone. That is what makes it safe: a model
 * catalog that is momentarily empty or unreachable cannot shrink anyone's list,
 * because the caller has to name the casualties.
 *
 * `emptied` is reported rather than acted on. An empty allowlist parses back to
 * null, which this codebase reads as "no restriction", so writing one would
 * quietly turn a locked key into an unlocked one. The caller keeps the old value
 * and surfaces it instead.
 */
export function applyModelChangesToAllowList(allowList, { removed = [], renamed = {} } = {}) {
  const original = String(allowList ?? "").trim();
  if (!original || original === "*") return { value: original, changed: false, emptied: false };

  const removedSet = new Set(removed.map((id) => String(id).trim().toLowerCase()).filter(Boolean));
  const tokens = original.split(",").map((t) => t.trim()).filter(Boolean);
  const kept = [];
  let touched = false;

  for (const token of tokens) {
    if (token.includes("*")) { kept.push(token); continue; }
    const lower = token.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(renamed, lower) || Object.prototype.hasOwnProperty.call(renamed, token)) {
      const replacement = renamed[lower] ?? renamed[token];
      const next = typeof replacement === "string" ? replacement.trim() : "";
      touched = true;
      if (next) kept.push(next);
      continue;
    }
    if (removedSet.has(lower)) { touched = true; continue; }
    kept.push(token);
  }

  if (!touched) return { value: original, changed: false, emptied: false };
  if (kept.length === 0) return { value: original, changed: false, emptied: true };
  const value = kept.join(",");
  return { value, changed: value !== original, emptied: false };
}
