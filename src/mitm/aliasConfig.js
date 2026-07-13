const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const REASONING_EFFORT_SET = new Set(REASONING_EFFORTS);
const ALIAS_ENTRY_FIELDS = new Set(["model", "reasoningEffort"]);

function normalizeReasoningEffort(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return REASONING_EFFORT_SET.has(normalized) ? normalized : null;
}

function normalizeAliasEntry(value) {
  if (typeof value === "string") {
    const model = value.trim();
    return model ? { model } : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const model = typeof value.model === "string" ? value.model.trim() : "";
  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
  if (!model && !reasoningEffort) return null;

  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function normalizeAliasMappings(mappings) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) return {};

  return Object.fromEntries(
    Object.entries(mappings).flatMap(([alias, value]) => {
      if (!alias) return [];
      const entry = normalizeAliasEntry(value);
      return entry ? [[alias, entry]] : [];
    })
  );
}

function hasInvalidReasoningEffort(mappings) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) return false;

  return Object.values(mappings).some(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.reasoningEffort != null &&
      value.reasoningEffort !== "" &&
      !normalizeReasoningEffort(value.reasoningEffort)
  );
}

function validateAliasMappings(mappings) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    return { ok: false, error: "mappings must be an object" };
  }

  for (const [alias, value] of Object.entries(mappings)) {
    if (!alias) return { ok: false, error: "mapping aliases must not be empty" };
    if (typeof value === "string") continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `mapping '${alias}' must be a string or object` };
    }
    if (Object.keys(value).some((field) => !ALIAS_ENTRY_FIELDS.has(field))) {
      return { ok: false, error: `mapping '${alias}' contains unsupported fields` };
    }
    if (value.model != null && typeof value.model !== "string") {
      return { ok: false, error: `mapping '${alias}'.model must be a string` };
    }
    if (value.reasoningEffort != null && typeof value.reasoningEffort !== "string") {
      return { ok: false, error: `mapping '${alias}'.reasoningEffort must be a string` };
    }
    if (
      value.reasoningEffort != null &&
      value.reasoningEffort.trim() !== "" &&
      !normalizeReasoningEffort(value.reasoningEffort)
    ) {
      return { ok: false, error: `mapping '${alias}'.reasoningEffort is unsupported` };
    }
  }

  return { ok: true, mappings: normalizeAliasMappings(mappings) };
}

module.exports = {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  normalizeAliasEntry,
  normalizeAliasMappings,
  hasInvalidReasoningEffort,
  validateAliasMappings,
};
