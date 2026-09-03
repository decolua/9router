import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { resolveModelAliasFromMap } from "open-sse/services/model.js";
import { isReservedProviderPrefix, resolveProviderId } from "@/shared/constants/providers";

export const COMBO_INPUT_CAPABILITIES = ["vision", "pdf", "audioInput", "videoInput"];

const CAPABILITY_LABELS = {
  vision: "Vision",
  pdf: "PDF input",
  audioInput: "Audio input",
  videoInput: "Video input",
};

function resolveModelCaps(key) {
  const slash = key.indexOf("/");
  const provider = slash === -1 ? null : resolveProviderId(key.slice(0, slash));
  const model = slash === -1 ? key : key.slice(slash + 1);
  return getCapabilitiesForModel(provider, model);
}

export function createComboCapsResolver(customModels = [], providerConnections = [], modelAliases = {}) {
  const overrides = new Map();
  for (const model of customModels) {
    if ((model.kind || model.type || "llm") !== "llm") continue;
    for (const provider of new Set([model.providerAlias, resolveProviderId(model.providerAlias)])) {
      overrides.set(`${provider}/${model.id}`, model.caps || {});
    }
  }
  const providersByPrefix = new Map(providerConnections
    .filter((connection) => connection.providerSpecificData?.prefix && !isReservedProviderPrefix(connection.providerSpecificData.prefix))
    .map((connection) => [connection.providerSpecificData.prefix, connection.provider]));
  return (key) => {
    // Mirror getModelInfoCore: bare entries may be user model aliases.
    const aliasTarget = !key.includes("/") ? resolveModelAliasFromMap(key, modelAliases) : null;
    const effectiveKey = aliasTarget ? `${aliasTarget.provider}/${aliasTarget.model}` : key;
    const slash = effectiveKey.indexOf("/");
    const routedProvider = slash === -1 ? null : effectiveKey.slice(0, slash);
    const provider = providersByPrefix.get(routedProvider) || routedProvider;
    const model = slash === -1 ? effectiveKey : effectiveKey.slice(slash + 1);
    return {
      ...getCapabilitiesForModel(provider ? resolveProviderId(provider) : null, model),
      ...(overrides.get(`${routedProvider}/${model}`) || overrides.get(`${resolveProviderId(provider)}/${model}`) || {}),
    };
  };
}

export function getComboCapsLimit(models, resolve = resolveModelCaps) {
  const resolved = (models || []).filter((model) => typeof model === "string" && model).map(resolve);
  if (resolved.length === 0) return null;
  return {
    contextWindow: Math.min(...resolved.map((caps) => caps.contextWindow)),
    ...Object.fromEntries(COMBO_INPUT_CAPABILITIES.map((key) => [key, resolved.every((caps) => caps[key] === true)])),
  };
}

export function validateComboCaps(caps, models, resolve) {
  if (!Array.isArray(models) || models.some((model) => typeof model !== "string" || !model.trim())) {
    return "Models must be an array of non-empty strings";
  }
  if (caps == null) return null;
  if (typeof caps !== "object" || Array.isArray(caps)) return "Capabilities must be an object";

  const allowed = new Set(["contextWindow", ...COMBO_INPUT_CAPABILITIES]);
  const unknown = Object.keys(caps).find((key) => !allowed.has(key));
  if (unknown) return `Unknown capability: ${unknown}`;
  if (caps.contextWindow !== undefined && (!Number.isSafeInteger(caps.contextWindow) || caps.contextWindow <= 0)) {
    return "Context window must be a positive integer";
  }
  for (const key of COMBO_INPUT_CAPABILITIES) {
    if (caps[key] !== undefined && typeof caps[key] !== "boolean") return `${key} must be boolean`;
  }

  const limit = getComboCapsLimit(models, resolve);
  if (!limit) return null;
  if (caps.contextWindow !== undefined && caps.contextWindow > limit.contextWindow) {
    return `Context window cannot exceed ${limit.contextWindow}, supported by every fallback model`;
  }
  for (const key of COMBO_INPUT_CAPABILITIES) {
    if (caps[key] === true && !limit[key]) return `${CAPABILITY_LABELS[key]} is not supported by every fallback model`;
  }
  return null;
}
