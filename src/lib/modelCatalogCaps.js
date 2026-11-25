import { ALIAS_TO_ID } from "@/shared/constants/providers";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const providerIds = {
  ...Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])),
  ...ALIAS_TO_ID,
};
export const catalogProviderId = alias => Object.hasOwn(providerIds, alias) ? providerIds[alias] : alias;
const registryModels = new Map(Object.entries(PROVIDER_MODELS).flatMap(([alias, rows]) =>
  rows.map(row => [catalogProviderId(alias) + "/" + row.id, row])));
export const validModelLimit = value => Number.isSafeInteger(value) && value > 0;

// Build once per listing. Only numeric limits from a custom shadow override
// the registry; a legacy thin shadow must not erase known capabilities.
export function catalogCapsResolver(customModels) {
  const overrides = new Map();
  for (const row of customModels) {
    if (row?.id && (row.kind || row.type || "llm") === "llm") {
      overrides.set(catalogProviderId(row.providerAlias) + "/" + row.id, row.caps || {});
    }
  }
  return (provider, model, prefix, liveCaps) => {
    const prefixKey = catalogProviderId(prefix) + "/" + model;
    // A custom row stored under a connection-specific prefix is also listed by
    // the dashboard under that name, including its fallback for omitted fields.
    const id = catalogProviderId(prefix && overrides.has(prefixKey) ? prefix : provider);
    const key = id + "/" + model;
    const caps = getCapabilitiesForModel(id, model);
    const custom = overrides.get(key);
    const registry = registryModels.get(key);
    // Only live-exclusive models use account-local limits. Both published
    // lists must resolve shared rows without contacting provider accounts.
    const live = !registry && !custom ? liveCaps : null;
    const firstLimit = (...values) => values.find(validModelLimit);
    return {
      ...caps,
      contextWindow: firstLimit(custom?.contextWindow, registry?.contextLength, live?.contextWindow, caps.contextWindow),
      maxOutput: firstLimit(custom?.maxOutput, registry?.maxOutputTokens, live?.maxOutput, caps.maxOutput),
    };
  };
}
