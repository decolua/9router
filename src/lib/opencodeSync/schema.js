const DEFAULT_VARIANT = "openagent";
const DEFAULT_MODEL_SELECTION_MODE = "exclude";

const VALID_VARIANTS = new Set(["openagent", "slim", "custom"]);
const VALID_CUSTOM_TEMPLATES = new Set([null, "minimal", "opinionated"]);
const VALID_MODEL_SELECTION_MODES = new Set(["include", "exclude"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const nextValue = normalizeString(value);
    if (!nextValue || seen.has(nextValue)) continue;
    seen.add(nextValue);
    normalized.push(nextValue);
  }

  return normalized;
}

function normalizeEnvVars(values) {
  if (!Array.isArray(values)) return [];

  const byKey = new Map();

  for (const item of values) {
    const key = normalizeString(item?.key);
    if (!key) continue;

    byKey.set(key, {
      key,
      value: typeof item?.value === "string" ? item.value : item?.value == null ? "" : String(item.value),
      secret: item?.secret === true,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeMcpServers(values) {
  return Array.isArray(values) ? values.filter((value) => value && typeof value === "object") : [];
}

function normalizeAdvancedOverrides(value) {
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    openagent:
      current.openagent && typeof current.openagent === "object" && !Array.isArray(current.openagent)
        ? current.openagent
        : {},
    slim:
      current.slim && typeof current.slim === "object" && !Array.isArray(current.slim)
        ? current.slim
        : {},
    custom:
      current.custom && typeof current.custom === "object" && !Array.isArray(current.custom)
        ? current.custom
        : {},
  };
}

export function createDefaultOpenCodePreferences() {
  return {
    variant: DEFAULT_VARIANT,
    customTemplate: null,
    defaultModel: null,
    modelSelectionMode: DEFAULT_MODEL_SELECTION_MODE,
    includedModels: [],
    excludedModels: [],
    customPlugins: [],
    mcpServers: [],
    envVars: [],
    advancedOverrides: {
      openagent: {},
      slim: {},
      custom: {},
    },
    updatedAt: null,
  };
}

export function normalizeOpenCodePreferences(input) {
  const base = createDefaultOpenCodePreferences();
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  return {
    ...base,
    ...source,
    variant: normalizeString(source.variant) || base.variant,
    customTemplate: normalizeNullableString(source.customTemplate),
    defaultModel: normalizeNullableString(source.defaultModel),
    modelSelectionMode: normalizeString(source.modelSelectionMode) || base.modelSelectionMode,
    includedModels: normalizeStringList(source.includedModels),
    excludedModels: normalizeStringList(source.excludedModels),
    customPlugins: normalizeStringList(source.customPlugins),
    mcpServers: normalizeMcpServers(source.mcpServers),
    envVars: normalizeEnvVars(source.envVars),
    advancedOverrides: normalizeAdvancedOverrides(source.advancedOverrides),
    updatedAt: normalizeNullableString(source.updatedAt),
  };
}

export function validateOpenCodePreferences(input) {
  const normalized = normalizeOpenCodePreferences(input);

  if (!VALID_VARIANTS.has(normalized.variant)) {
    throw new Error("Invalid OpenCode variant");
  }

  if (!VALID_CUSTOM_TEMPLATES.has(normalized.customTemplate)) {
    throw new Error("Invalid custom template");
  }

  if (normalized.variant !== "custom" && normalized.customTemplate !== null) {
    throw new Error("Custom template is only valid for custom variant");
  }

  if (!VALID_MODEL_SELECTION_MODES.has(normalized.modelSelectionMode)) {
    throw new Error("Invalid model selection mode");
  }

  return normalized;
}

export function sanitizeOpenCodePreferencesForResponse(input) {
  const normalized = normalizeOpenCodePreferences(input);

  return {
    ...normalized,
    envVars: normalized.envVars.map((item) =>
      item.secret
        ? { ...item, value: "********" }
        : { ...item }
    ),
  };
}
