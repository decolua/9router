// Pure helpers for the claude default-model mapping (endpoint page →
// one-click write into ~/.claude/settings.json env). No imports — safe for
// both server routes and client bundles.
//
// Semantics (strict): the write is a key-overwrite on env only —
// env = { ...current, ...overrides }. Keys absent from the overrides are
// never deleted and no non-env key is ever touched.

export const CLAUDE_ROLE_KEYS = ["sonnet", "opus", "fable", "haiku"];

export function emptyClaudeDefaults() {
  const d = {};
  for (const role of CLAUDE_ROLE_KEYS) d[role] = { model: "", name: "", oneM: false };
  // Subagent (Task tool) model — has no /model-menu presence, so no name.
  d.subagent = { model: "", oneM: false };
  return d;
}

// Sanitize a defaultModels blob (dashboard body or persisted settings).
// Unknown shapes fall back to empty strings so a malformed payload can never
// inject weird env values into the user's settings.json.
export function sanitizeDefaultModels(raw) {
  const clean = emptyClaudeDefaults();
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  for (const role of CLAUDE_ROLE_KEYS) {
    const src = raw?.[role] || {};
    clean[role] = { model: str(src.model), name: str(src.name), oneM: src.oneM === true };
  }
  const sa = raw?.subagent || {};
  clean.subagent = { model: str(sa.model), oneM: sa.oneM === true };
  return clean;
}

// Pure mapping: defaultModels → env overrides object (no deletes — an empty
// role contributes no keys, leaving existing env values intact). Suffix is
// [1M] (uppercase, matching cc-switch). A role without a display name omits
// its _MODEL_NAME key. The subagent row maps to CLAUDE_CODE_SUBAGENT_MODEL.
export function buildClaudeEnvOverrides(defaultModels) {
  const set = {};
  const withSuffix = (model, oneM) => (oneM ? `${model}[1M]` : model);
  for (const role of CLAUDE_ROLE_KEYS) {
    const cfg = defaultModels?.[role] || {};
    if (!cfg.model) continue;
    set[`ANTHROPIC_DEFAULT_${role.toUpperCase()}_MODEL`] = withSuffix(cfg.model, cfg.oneM);
    if (cfg.name) set[`ANTHROPIC_DEFAULT_${role.toUpperCase()}_MODEL_NAME`] = cfg.name;
  }
  if (defaultModels?.subagent?.model) {
    set.CLAUDE_CODE_SUBAGENT_MODEL = withSuffix(defaultModels.subagent.model, defaultModels.subagent.oneM);
  }
  return set;
}

// Coerce a user-edited env JSON blob into a clean {string: string} map.
// Strings pass through; numbers/booleans stringify; null/objects/arrays are
// dropped.
export function sanitizeEnvOverrides(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") clean[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") clean[k] = String(v);
  }
  return clean;
}

// Strict key-overwrite merge into a parsed settings.json object. Only env
// keys present in overrides change; every other env key and all non-env
// top-level keys survive verbatim.
export function mergeClaudeEnv(settingsJson, envOverrides) {
  return { ...settingsJson, env: { ...(settingsJson?.env || {}), ...envOverrides } };
}
