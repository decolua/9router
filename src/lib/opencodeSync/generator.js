import crypto from "crypto";

import { createOpenCodeValidationError, sanitizeSensitiveConfig, validateOpenCodePreferences } from "./schema.js";
import {
  getCustomTemplatePreset,
  getVariantPreset,
  OPENAGENT_PRESET_PLUGIN,
  OPENCODE_SYNC_PLUGIN,
  SLIM_PRESET_PLUGIN,
} from "./presets.js";

export const OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION = 1;

const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
const OPENAGENT_CONFIG_SCHEMA =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/main/assets/oh-my-opencode.schema.json";
const SLIM_CONFIG_SCHEMA = "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json";
const NINEROUTER_PROVIDER_ID = "9router";
const NINEROUTER_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";
const NINEROUTER_PROVIDER_NAME = "9Router";
const DEFAULT_PROVIDER_BASE_URL = "http://localhost:20129/v1";
const DEFAULT_PROVIDER_API_KEY = "sk_9router";

const PLUGIN_PRIORITY = new Map([
  [OPENCODE_SYNC_PLUGIN, 0],
  [OPENAGENT_PRESET_PLUGIN, 1],
  [SLIM_PRESET_PLUGIN, 2],
]);

const DEFAULT_MODALITIES = { input: ["text", "image"], output: ["text"] };

/**
 * Detect whether a model supports reasoning/thinking variants.
 */
function supportsReasoning(modelId) {
  const id = modelId.toLowerCase();
  if (id.includes("thinking") || id.includes("reasoning")) return true;
  if (id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) return true;
  return false;
}

/**
 * Infer model metadata (context, output, modalities, attachment) from model ID.
 * This matches the logic in cliproxyapi-dashboard's inferModelDefinition.
 */
function inferModelMetadata(modelId, ownedBy = "") {
  const isReasoning = supportsReasoning(modelId);
  const id = modelId.toLowerCase();
  const provider = (ownedBy || "").toLowerCase();

  // Default limits
  let context = 200000;
  let output = 64000;

  // Provider-specific heuristics
  if (provider === "google" || provider === "antigravity" || provider === "ag" || id.includes("gemini")) {
    context = 1048576;
    output = 65536;
  } else if (provider === "openai" || provider === "cx" || provider === "gh" || id.startsWith("gpt")) {
    context = 400000;
    output = 128000;
    // GPT-5.x models have larger context
    if (id.includes("gpt-5.4") || id.includes("gpt-5.3")) {
      context = 1050000;
      output = 128000;
    }
  } else if (provider === "anthropic" || provider === "cc" || id.includes("claude")) {
    context = 200000;
    output = 32000;
    // Claude 4.x models have larger context
    if (id.includes("claude-4") || id.includes("claude-opus-4") || id.includes("claude-sonnet-4")) {
      context = 200000;
      output = 64000;
    }
  } else if (provider === "deepseek" || id.includes("deepseek")) {
    context = 128000;
    output = 8192;
    if (id.includes("r1") || id.includes("reasoner")) {
      context = 64000;
      output = 8192;
    }
  } else if (provider === "qwen" || provider === "qw" || provider === "if" || id.includes("qwen")) {
    context = 128000;
    output = 8192;
  } else if (id.includes("glm")) {
    context = 128000;
    output = 4096;
  }

  // Build name from model ID
  const name = modelId
    .replace(/-\d{8}$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return {
    name,
    context,
    output,
    attachment: true,
    reasoning: isReasoning,
    modalities: DEFAULT_MODALITIES,
  };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = stableClone(value[key]);
      return result;
    }, {});
}

function mergePlainObjects(base, override) {
  if (!isPlainObject(base)) {
    return stableClone(override);
  }

  if (!isPlainObject(override)) {
    return stableClone(base);
  }

  const merged = {};

  for (const key of Object.keys(base)) {
    merged[key] = stableClone(base[key]);
  }

  for (const key of Object.keys(override)) {
    if (isPlainObject(merged[key]) && isPlainObject(override[key])) {
      merged[key] = mergePlainObjects(merged[key], override[key]);
      continue;
    }

    merged[key] = stableClone(override[key]);
  }

  return stableClone(merged);
}

function getModelIds(models) {
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return [];
  }

  return Object.keys(models).sort((left, right) => left.localeCompare(right));
}

function getPrimaryVariantModels(bundle) {
  const modelIds = getModelIds(bundle?.models);
  const preferred = typeof bundle?.defaultModel === "string" && modelIds.includes(bundle.defaultModel) ? bundle.defaultModel : modelIds[0] || "";
  const secondary = modelIds.find((modelId) => modelId !== preferred) || preferred;
  const tertiary = modelIds.find((modelId) => modelId !== preferred && modelId !== secondary) || secondary || preferred;

  return {
    preferred,
    secondary,
    tertiary,
  };
}

function buildGeneratedVariantConfig(bundle) {
  const advancedOverrides = isPlainObject(bundle?.advancedOverrides) ? bundle.advancedOverrides : {};

  if (bundle?.variant === "custom") {
    return stableClone(advancedOverrides);
  }

  const { preferred, secondary, tertiary } = getPrimaryVariantModels(bundle);

  if (bundle?.variant === "slim") {
    return mergePlainObjects(
      {
        preset: "balanced",
        agentAssignments: {
          core: preferred,
          research: secondary,
          execution: secondary,
        },
        categoryAssignments: {
          default: preferred,
          "long-context": preferred,
          "low-latency": secondary,
        },
      },
      advancedOverrides
    );
  }

  return mergePlainObjects(
    {
      preset: "balanced",
      agentAssignments: {
        explorer: secondary,
        sisyphus: preferred,
        oracle: preferred,
        librarian: secondary,
        prometheus: preferred,
        atlas: secondary,
      },
      categoryAssignments: {
        deep: preferred,
        quick: secondary,
        "visual-engineering": secondary,
        writing: preferred,
        artistry: tertiary,
      },
    },
    advancedOverrides
  );
}

function buildGeneratedArtifacts(bundle, apiKey = null) {
  const advancedConfig = buildGeneratedVariantConfig(bundle);

  const artifacts = {
    "opencode.json": buildOpenCodeArtifact(bundle, apiKey),
  };

  if (bundle?.variant === "openagent") {
    artifacts["oh-my-openagent.json"] = buildOpenAgentArtifact(advancedConfig);
    return artifacts;
  }

  if (bundle?.variant === "slim") {
    artifacts["oh-my-opencode-slim.json"] = buildSlimArtifact(advancedConfig);
    return artifacts;
  }

  return artifacts;
}

function sanitizePublicArtifact(value) {
  return sanitizeSensitiveConfig(stableClone(value));
}

function buildPublicArtifactSet(generatedArtifacts = {}) {
  return stableClone({
    opencode: generatedArtifacts["opencode.json"] ?? null,
    ohMyOpencode: generatedArtifacts["oh-my-openagent.json"]
      ? sanitizePublicArtifact(generatedArtifacts["oh-my-openagent.json"])
      : null,
    ohMyOpenCodeSlim: generatedArtifacts["oh-my-opencode-slim.json"]
      ? sanitizePublicArtifact(generatedArtifacts["oh-my-opencode-slim.json"])
      : null,
  });
}

function getArtifactModelId(modelId) {
  if (typeof modelId !== "string") return "";
  const normalized = modelId.trim();
  if (!normalized) return "";
  // Keep the full model ID with provider prefix (e.g., cx/gpt-5.3-codex)
  return normalized;
}

function assertUniqueArtifactModelIds(models) {
  const collisions = new Map();

  for (const modelId of getModelIds(models)) {
    const artifactModelId = getArtifactModelId(modelId);
    if (!artifactModelId) continue;

    const normalizedIds = collisions.get(artifactModelId) || [];
    normalizedIds.push(modelId);
    collisions.set(artifactModelId, normalizedIds);
  }

  for (const [artifactModelId, modelIds] of collisions.entries()) {
    if (modelIds.length > 1) {
      throw createOpenCodeValidationError(
        `Multiple selected models normalize to the same artifact model id "${artifactModelId}": ${modelIds.join(", ")}`
      );
    }
  }
}

function hasOwnValue(object, key) {
  return isPlainObject(object) && Object.hasOwn(object, key);
}

function titleCaseWords(value) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function getConfigModelName(source, configModelId) {
  // Always use configModelId (full model ID with provider prefix)
  // This ensures model name matches the ID format: cx/gpt-5.3-codex
  if (configModelId) {
    return configModelId;
  }

  if (typeof source.label === "string" && source.label.trim()) {
    return source.label.trim();
  }

  if (typeof source.name === "string" && source.name.trim()) {
    return source.name.trim();
  }

  return "";
}

function normalizeModalities(source) {
  if (!isPlainObject(source.modalities)) {
    return null;
  }

  const normalized = {};

  for (const key of ["input", "output"]) {
    if (Array.isArray(source.modalities[key]) && source.modalities[key].length > 0) {
      normalized[key] = stableClone(source.modalities[key]);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeLimit(source) {
  const context = Number.isFinite(source.limit?.context)
    ? source.limit.context
    : Number.isFinite(source.contextWindow)
      ? source.contextWindow
      : Number.isFinite(source.maxInputTokens)
        ? source.maxInputTokens
        : null;
  const output = Number.isFinite(source.limit?.output)
    ? source.limit.output
    : Number.isFinite(source.maxOutputTokens)
      ? source.maxOutputTokens
      : null;
  const normalized = {};

  if (context !== null) normalized.context = context;
  if (output !== null) normalized.output = output;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildConfigModelMetadata(modelId, value) {
  const source = isPlainObject(value) ? value : {};
  const configModelId = getArtifactModelId(modelId);
  
  // Check if we have complete metadata from source
  const hasModalities = isPlainObject(source.modalities);
  const hasLimit = isPlainObject(source.limit) || 
    Number.isFinite(source.contextWindow) || 
    Number.isFinite(source.maxInputTokens) || 
    Number.isFinite(source.maxOutputTokens);
  
  // If missing critical metadata, infer from model ID
  const inferred = (!hasModalities || !hasLimit) 
    ? inferModelMetadata(configModelId, source.provider || source.owned_by || "")
    : null;

  const metadata = {
    name: getConfigModelName(source, configModelId),
  };

  // Attachment: prefer source, else default to true
  if (hasOwnValue(source, "attachment")) {
    metadata.attachment = source.attachment === true;
  } else {
    metadata.attachment = inferred?.attachment ?? true;
  }

  // Modalities: prefer source, else use inferred/default
  const modalities = normalizeModalities(source);
  if (modalities) {
    metadata.modalities = modalities;
  } else if (inferred?.modalities) {
    metadata.modalities = stableClone(inferred.modalities);
  }

  // Limit: prefer source, else use inferred
  const limit = normalizeLimit(source);
  if (limit) {
    metadata.limit = limit;
  } else if (inferred) {
    metadata.limit = { context: inferred.context, output: inferred.output };
  }

  // Reasoning: add if supported
  if (source.reasoning === true || inferred?.reasoning) {
    metadata.reasoning = true;
  }

  return stableClone(metadata);
}

function buildMcpArtifactConfig(mcpServers = []) {
  return (Array.isArray(mcpServers) ? mcpServers : []).reduce((result, server, index) => {
    const name = server?.name || `server-${index + 1}`;

    if (server?.type === "remote") {
      result[name] = {
        type: "remote",
        url: server?.url || "",
      };
      return result;
    }

    result[name] = {
      type: "local",
      command: Array.isArray(server?.command)
        ? stableClone(server.command)
        : typeof server?.command === "string"
          ? server.command
          : [],
    };

    return result;
  }, {});
}

function buildEnvArtifactConfig(envVars = []) {
  return (Array.isArray(envVars) ? envVars : []).reduce((result, item) => {
    if (!item?.key) return result;
    result[item.key] = item?.secret ? "<set-locally>" : item?.value || "";
    return result;
  }, {});
}

function buildOpenCodeArtifact(bundle, apiKey = null) {
  const resolvedModels = bundle?.models && typeof bundle.models === "object" ? bundle.models : {};
  assertUniqueArtifactModelIds(resolvedModels);
  const providerModels = Object.keys(resolvedModels).sort((left, right) => left.localeCompare(right)).reduce((result, modelId) => {
    const artifactModelId = getArtifactModelId(modelId);
    if (!artifactModelId) {
      return result;
    }

    result[artifactModelId] = buildConfigModelMetadata(modelId, resolvedModels[modelId]);
    return result;
  }, {});
  const providerModelIds = Object.keys(providerModels);
  const defaultArtifactModelId = getArtifactModelId(bundle?.defaultModel);
  const activeModelId = defaultArtifactModelId && providerModelIds.includes(defaultArtifactModelId)
    ? defaultArtifactModelId
    : providerModelIds[0] || "";

  // Use provided apiKey or default
  const finalApiKey = apiKey || DEFAULT_PROVIDER_API_KEY;

  return stableClone({
    $schema: OPENCODE_CONFIG_SCHEMA,
    plugin: Array.isArray(bundle?.plugins) ? bundle.plugins : [],
    provider: {
      [NINEROUTER_PROVIDER_ID]: {
        npm: NINEROUTER_PROVIDER_PACKAGE,
        name: NINEROUTER_PROVIDER_NAME,
        options: {
          baseURL: DEFAULT_PROVIDER_BASE_URL,
          apiKey: finalApiKey,
        },
        models: providerModels,
      },
    },
    model: activeModelId ? `${NINEROUTER_PROVIDER_ID}/${activeModelId}` : "",
    ...(Array.isArray(bundle?.mcpServers) && bundle.mcpServers.length > 0
      ? { mcp: buildMcpArtifactConfig(bundle.mcpServers) }
      : {}),
    ...(Array.isArray(bundle?.envVars) && bundle.envVars.length > 0
      ? { env: buildEnvArtifactConfig(bundle.envVars) }
      : {}),
  });
}

function buildPrefixedModelReference(modelId) {
  const normalized = getArtifactModelId(modelId);
  return normalized ? `${NINEROUTER_PROVIDER_ID}/${normalized}` : "";
}

function buildModelAssignmentMap(assignments) {
  if (!isPlainObject(assignments)) {
    return undefined;
  }

  const normalized = Object.keys(assignments)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      const value = buildPrefixedModelReference(assignments[key]);
      if (!value) {
        return result;
      }

      result[key] = { model: value };
      return result;
    }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function pickRelevantConfigFields(config, excludedKeys = [], { omitBalancedPreset = false } = {}) {
  if (!isPlainObject(config)) {
    return {};
  }

  const excluded = new Set(excludedKeys);

  return Object.keys(config)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      if (excluded.has(key)) {
        return result;
      }

      const value = config[key];
      if (omitBalancedPreset && key === "preset" && value === "balanced") {
        return result;
      }

      if (value == null) {
        return result;
      }

      if (Array.isArray(value) && value.length === 0) {
        return result;
      }

      if (isPlainObject(value) && Object.keys(value).length === 0) {
        return result;
      }

      result[key] = stableClone(value);
      return result;
    }, {});
}

function buildOpenAgentArtifact(config) {
  const agents = buildModelAssignmentMap(config?.agentAssignments);
  const categories = buildModelAssignmentMap(config?.categoryAssignments);

  return stableClone({
    $schema: OPENAGENT_CONFIG_SCHEMA,
    ...(agents ? { agents } : {}),
    ...(categories ? { categories } : {}),
    auto_update: false,
    background_task: {
      defaultConcurrency: 5,
    },
    sisyphus_agent: {
      planner_enabled: true,
      replace_plan: true,
    },
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
    },
    ...pickRelevantConfigFields(config, ["agentAssignments", "categoryAssignments", "preset"]),
  });
}

function buildSlimArtifact(config) {
  const agents = buildModelAssignmentMap(config?.agentAssignments);

  return stableClone({
    $schema: SLIM_CONFIG_SCHEMA,
    ...(agents ? { agents } : {}),
    ...pickRelevantConfigFields(config, ["agentAssignments", "categoryAssignments"], {
      omitBalancedPreset: true,
    }),
  });
}

function comparePlugins(left, right) {
  const leftPriority = PLUGIN_PRIORITY.has(left) ? PLUGIN_PRIORITY.get(left) : Number.MAX_SAFE_INTEGER;
  const rightPriority = PLUGIN_PRIORITY.has(right) ? PLUGIN_PRIORITY.get(right) : Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.localeCompare(right);
}

function normalizeCatalogEntry(id, value) {
  if (!id) return null;

  if (isPlainObject(value)) {
    return stableClone({
      ...value,
      id,
    });
  }

  if (value == null) {
    return { id };
  }

  return {
    id,
    value,
  };
}

function getCatalogEntryId(item, fallbackId = "") {
  if (typeof item === "string") return item.trim();
  if (!isPlainObject(item)) return fallbackId;

  for (const key of ["id", "key", "model"]) {
    if (typeof item[key] === "string" && item[key].trim()) {
      return item[key].trim();
    }
  }

  return fallbackId;
}

function normalizeModelCatalog(modelCatalog) {
  const normalized = new Map();

  if (Array.isArray(modelCatalog)) {
    for (const item of modelCatalog) {
      const id = getCatalogEntryId(item);
      if (!id) continue;
      normalized.set(id, normalizeCatalogEntry(id, item));
    }
    return normalized;
  }

  if (!isPlainObject(modelCatalog)) {
    return normalized;
  }

  for (const key of Object.keys(modelCatalog).sort((left, right) => left.localeCompare(right))) {
    const id = getCatalogEntryId(modelCatalog[key], key) || key;
    if (!id) continue;
    normalized.set(id, normalizeCatalogEntry(id, modelCatalog[key]));
  }

  return normalized;
}

function buildDeterministicPluginList(preferences) {
  const variantPreset = getVariantPreset(preferences.variant);
  const templatePreset = getCustomTemplatePreset(preferences.customTemplate);
  const plugins = new Set([OPENCODE_SYNC_PLUGIN]);

  if (preferences.variant !== "custom" && variantPreset?.plugin) {
    plugins.add(variantPreset.plugin);
  }

  if (preferences.variant === "custom" && templatePreset?.plugin) {
    plugins.add(templatePreset.plugin);
  }

  for (const plugin of preferences.customPlugins) {
    if (plugin) plugins.add(plugin);
  }

  return Array.from(plugins).sort(comparePlugins);
}

function buildDeterministicModelMap(preferences, modelCatalog) {
  const catalog = normalizeModelCatalog(modelCatalog);
  const excluded = new Set(preferences.excludedModels);

  let modelIds = [];

  if (preferences.modelSelectionMode === "include") {
    modelIds = preferences.includedModels.filter((modelId) => catalog.has(modelId));
  } else {
    modelIds = Array.from(catalog.keys()).filter((modelId) => !excluded.has(modelId));
  }

  const uniqueModelIds = Array.from(new Set(modelIds)).sort((left, right) => left.localeCompare(right));

  return uniqueModelIds.reduce((result, modelId) => {
    result[modelId] = stableClone(catalog.get(modelId));
    return result;
  }, {});
}

function buildMetadata(source) {
  const canonical = JSON.stringify(stableClone(source));
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");

  return {
    schemaVersion: OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION,
    revision: hash.slice(0, 12),
    hash,
  };
}

export function buildOpenCodeSyncBundle({ preferences, modelCatalog, apiKey = null } = {}) {
  const normalizedPreferences = validateOpenCodePreferences(preferences);
  const variantPreset = getVariantPreset(normalizedPreferences.variant);
  const customTemplatePreset = getCustomTemplatePreset(normalizedPreferences.customTemplate);
  const plugins = buildDeterministicPluginList(normalizedPreferences);
  const models = buildDeterministicModelMap(normalizedPreferences, modelCatalog);
  const templateBundle =
    normalizedPreferences.variant === "custom" ? customTemplatePreset?.bundle || {} : {};
  const advancedOverrides = mergePlainObjects(
    templateBundle.advancedOverrides || {},
    normalizedPreferences.advancedOverrides[normalizedPreferences.variant] || {}
  );

  if (normalizedPreferences.defaultModel && !Object.hasOwn(models, normalizedPreferences.defaultModel)) {
    throw createOpenCodeValidationError("Default model must be included in generated bundle models");
  }

  const bundle = {
    variant: normalizedPreferences.variant,
    customTemplate: normalizedPreferences.customTemplate,
    defaultModel: normalizedPreferences.defaultModel,
    modelSelectionMode: normalizedPreferences.modelSelectionMode,
    plugins,
    models,
    mcpServers: stableClone(normalizedPreferences.mcpServers),
    envVars: stableClone(normalizedPreferences.envVars),
    advancedOverrides,
  };

  bundle.generatedAdvancedConfig = buildGeneratedVariantConfig(bundle);
  bundle.generatedArtifacts = buildGeneratedArtifacts(bundle, apiKey);

  const publicArtifacts = buildPublicArtifactSet(bundle.generatedArtifacts);

  const metadata = buildMetadata(publicArtifacts);
  const generatedAt = new Date().toISOString();

  return {
    ...metadata,
    generatedAt,
    publicArtifacts,
    bundle,
  };
}

export function buildOpenCodeSyncPreview(args = {}) {
  const result = buildOpenCodeSyncBundle(args);
  const sanitizedBundle = sanitizeSensitiveConfig(result.bundle);

  return {
    ...result,
    bundle: sanitizedBundle,
    preview: {
      variant: sanitizedBundle.variant,
      customTemplate: sanitizedBundle.customTemplate,
      defaultModel: sanitizedBundle.defaultModel,
      modelCount: Object.keys(sanitizedBundle.models).length,
      pluginCount: sanitizedBundle.plugins.length,
      plugins: [...sanitizedBundle.plugins],
      modelIds: Object.keys(sanitizedBundle.models),
    },
  };
}
