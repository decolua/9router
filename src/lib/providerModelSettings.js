import { normalizeModelsUrl } from "./providerModelsUrl.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function normalizeProviderModelSettings(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider model settings must be an object");
  }

  return Object.fromEntries(Object.entries(value).map(([providerId, config]) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`Invalid model settings for provider ${providerId}`);
    }
    return [providerId, {
      modelsUrl: normalizeModelsUrl(config.modelsUrl) || "",
      testModel: String(config.testModel || "").trim(),
    }];
  }));
}

export function getProviderModelSettings(settings, providerId, legacy = {}) {
  const providerSettings = settings?.providerModelSettings;
  const config = providerSettings && hasOwn(providerSettings, providerId)
    ? providerSettings[providerId]
    : null;

  return {
    modelsUrl: String(config && hasOwn(config, "modelsUrl") ? config.modelsUrl || "" : legacy.modelsUrl || "").trim(),
    testModel: String(config && hasOwn(config, "testModel") ? config.testModel || "" : legacy.testModel || "").trim(),
  };
}
