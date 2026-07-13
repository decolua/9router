const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const REASONING_EFFORT_SET = new Set(REASONING_EFFORTS);

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
  const normalized = {};
  for (const [alias, value] of Object.entries(mappings)) {
    if (!alias) continue;
    const entry = normalizeAliasEntry(value);
    if (entry) normalized[alias] = entry;
  }
  return normalized;
}

function hasInvalidReasoningEffort(mappings) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) return false;
  return Object.values(mappings).some((value) => (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.reasoningEffort != null &&
    value.reasoningEffort !== "" &&
    !normalizeReasoningEffort(value.reasoningEffort)
  ));
}

module.exports = {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  normalizeAliasEntry,
  normalizeAliasMappings,
  hasInvalidReasoningEffort,
};
