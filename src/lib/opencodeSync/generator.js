import crypto from "crypto";

import { validateOpenCodePreferences } from "./schema.js";
import {
  getCustomTemplatePreset,
  getVariantPreset,
  OPENAGENT_PRESET_PLUGIN,
  OPENCODE_SYNC_PLUGIN,
  SLIM_PRESET_PLUGIN,
} from "./presets.js";

export const OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION = 1;

const PLUGIN_PRIORITY = new Map([
  [OPENCODE_SYNC_PLUGIN, 0],
  [OPENAGENT_PRESET_PLUGIN, 1],
  [SLIM_PRESET_PLUGIN, 2],
]);

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

  for (const key of ["id", "key", "model", "name"]) {
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

export function buildOpenCodeSyncBundle({ preferences, modelCatalog } = {}) {
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
    throw new Error("Default model must be included in generated bundle models");
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

  const metadata = buildMetadata({
    schemaVersion: OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION,
    bundle,
    variantPreset,
    customTemplatePreset,
  });

  return {
    ...metadata,
    bundle,
  };
}

export function buildOpenCodeSyncPreview(args = {}) {
  const result = buildOpenCodeSyncBundle(args);

  return {
    ...result,
    preview: {
      variant: result.bundle.variant,
      customTemplate: result.bundle.customTemplate,
      defaultModel: result.bundle.defaultModel,
      modelCount: Object.keys(result.bundle.models).length,
      pluginCount: result.bundle.plugins.length,
      plugins: [...result.bundle.plugins],
      modelIds: Object.keys(result.bundle.models),
    },
  };
}
