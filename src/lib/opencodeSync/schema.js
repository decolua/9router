const DEFAULT_VARIANT = "openagent";
const DEFAULT_MODEL_SELECTION_MODE = "exclude";

const VALID_VARIANTS = new Set(["openagent", "slim", "custom"]);
const VALID_CUSTOM_TEMPLATES = new Set([null, "minimal", "opinionated"]);
const VALID_MODEL_SELECTION_MODES = new Set(["include", "exclude"]);
const VALID_MCP_SERVER_TYPES = new Set(["local", "remote"]);
const REDACTED_VALUE = "********";

export function createOpenCodeValidationError(message) {
  const error = new Error(message);
  error.name = "OpenCodeValidationError";
  error.code = "OPENCODE_VALIDATION_ERROR";
  return error;
}

export function isOpenCodeValidationError(error) {
  return error?.code === "OPENCODE_VALIDATION_ERROR" || error?.name === "OpenCodeValidationError";
}

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

function normalizeMcpCommand(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  const normalized = normalizeString(value);
  return normalized ? normalized : "";
}

function normalizeMcpServer(server) {
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;

  const explicitType = normalizeString(server.type);
  const type = explicitType || "local";
  const normalized = {
    name: normalizeString(server.name),
  };

  if (explicitType) {
    normalized.type = explicitType;
  }

  if (type === "remote") {
    normalized.url = normalizeString(server.url);
  } else {
    normalized.command = normalizeMcpCommand(server.command);
  }

  return normalized;
}

function normalizeMcpServers(values) {
  return Array.isArray(values) ? values.map((value) => normalizeMcpServer(value)).filter(Boolean) : [];
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
    throw createOpenCodeValidationError("Invalid OpenCode variant");
  }

  if (!VALID_CUSTOM_TEMPLATES.has(normalized.customTemplate)) {
    throw createOpenCodeValidationError("Invalid custom template");
  }

  if (normalized.variant !== "custom" && normalized.customTemplate !== null) {
    throw createOpenCodeValidationError("Custom template is only valid for custom variant");
  }

  if (!VALID_MODEL_SELECTION_MODES.has(normalized.modelSelectionMode)) {
    throw createOpenCodeValidationError("Invalid model selection mode");
  }

  const seenMcpNames = new Set();

  for (const server of normalized.mcpServers) {
    if (!server.name) {
      throw createOpenCodeValidationError("Invalid MCP server: name is required");
    }

    const duplicateKey = server.name.toLowerCase();
    if (seenMcpNames.has(duplicateKey)) {
      throw createOpenCodeValidationError(`Duplicate MCP server name: ${server.name}`);
    }
    seenMcpNames.add(duplicateKey);

    const serverType = server.type || "local";

    if (!VALID_MCP_SERVER_TYPES.has(serverType)) {
      throw createOpenCodeValidationError(`Invalid MCP server type for ${server.name}`);
    }

    if (serverType === "remote") {
      if (!server.url) {
        throw createOpenCodeValidationError(`Remote MCP server \"${server.name}\" requires a URL`);
      }

      try {
        const parsedUrl = new URL(server.url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("unsupported");
        }
      } catch {
        throw createOpenCodeValidationError(`Invalid MCP server URL for ${server.name}`);
      }

      continue;
    }

    if (Array.isArray(server.command)) {
      if (server.command.length === 0) {
        throw createOpenCodeValidationError(`Local MCP server \"${server.name}\" requires a command`);
      }
    } else if (!server.command) {
      throw createOpenCodeValidationError(`Local MCP server \"${server.name}\" requires a command`);
    }
  }

  return normalized;
}

function isSensitiveKey(key) {
  const loweredKey = normalizeString(key).toLowerCase();

  if (["secret", "issecret", "sensitive"].includes(loweredKey)) {
    return false;
  }

  if (loweredKey.includes("secret") || loweredKey.includes("password") || loweredKey.includes("authorization")) {
    return true;
  }

  if (loweredKey === "apikey" || loweredKey === "api_key" || loweredKey.endsWith("apikey") || loweredKey.endsWith("api_key")) {
    return true;
  }

  if (["token", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "bearertoken"].includes(loweredKey)) {
    return true;
  }

  if (loweredKey.endsWith("token") && !loweredKey.endsWith("tokens")) {
    return true;
  }

  return false;
}

export function sanitizeSensitiveConfig(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitiveConfig(entry, key));
  }

  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const objectLooksSecret = value.secret === true || value.isSecret === true || value.sensitive === true;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      if (objectLooksSecret && entryKey === "value") {
        return [entryKey, REDACTED_VALUE];
      }

      if (isSensitiveKey(entryKey)) {
        return [entryKey, REDACTED_VALUE];
      }

      return [entryKey, sanitizeSensitiveConfig(entryValue, entryKey)];
    })
  );
}

export function sanitizeOpenCodePreferencesForResponse(input) {
  return sanitizeSensitiveConfig(normalizeOpenCodePreferences(input));
}
