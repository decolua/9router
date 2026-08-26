import { getCustomModels, getPricingMappings, getPricingModels, getSettings } from "@/lib/localDb";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import REGISTRY from "open-sse/providers/registry/index.js";

const RATE_FIELDS = ["input", "output", "cached", "cache_creation", "reasoning"];
export const EMPTY_PRICING = Object.fromEntries(RATE_FIELDS.map((field) => [field, 0]));

function providerNames() {
  const names = new Map();
  for (const provider of REGISTRY) {
    const name = provider.display?.name || provider.name || provider.id;
    for (const key of [provider.id, provider.alias, ...(provider.aliases || [])].filter(Boolean)) names.set(key, name);
  }
  return names;
}

export async function getProviderPricingCatalog() {
  const customModels = await getCustomModels();
  const names = providerNames();
  const catalog = new Map();
  const add = (provider, model) => {
    const cleanProvider = String(provider || "").trim();
    const cleanModel = String(model || "").trim();
    if (!cleanProvider || !cleanModel) return;
    const id = `${cleanProvider}\u0000${cleanModel}`;
    if (!catalog.has(id)) catalog.set(id, {
      id,
      provider: cleanProvider,
      providerName: names.get(cleanProvider) || cleanProvider,
      model: cleanModel,
    });
  };

  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    for (const model of models || []) add(provider, typeof model === "string" ? model : model?.id);
  }
  for (const model of customModels) add(model.providerAlias, model.id);

  return [...catalog.values()].sort((a, b) =>
    a.providerName.localeCompare(b.providerName) || a.model.localeCompare(b.model),
  );
}

export async function getPricingPageData() {
  const [pricingModels, mappings, settings, providerModels] = await Promise.all([
    getPricingModels(),
    getPricingMappings(),
    getSettings(),
    getProviderPricingCatalog(),
  ]);
  const mappingMap = new Map(mappings.map((item) => [`${item.provider}\u0000${item.model}`, item.pricingModel]));
  const counts = new Map();
  for (const mapping of mappings) counts.set(mapping.pricingModel, (counts.get(mapping.pricingModel) || 0) + 1);
  const normalizedIds = new Map(Object.keys(pricingModels).map((model) => [model.toLowerCase(), model]));

  const priced = Object.entries(pricingModels).map(([model, pricing]) => ({
    model,
    pricing: { ...EMPTY_PRICING, ...pricing },
    mappedCount: counts.get(model) || 0,
    isDefault: settings.defaultPricingModel === model,
  })).sort((a, b) => a.model.localeCompare(b.model));

  const catalog = providerModels.map((item) => {
    const mappedPricingModel = mappingMap.get(item.id) || "";
    return {
      ...item,
      mappedPricingModel,
      effectivePricingModel: mappedPricingModel || settings.defaultPricingModel || "",
      usesDefault: !mappedPricingModel && !!settings.defaultPricingModel,
      recommendedPricingModel: normalizedIds.get(item.model.toLowerCase()) || "",
    };
  });

  return {
    priced,
    providerModels: catalog,
    unpriced: catalog.filter((item) => !item.mappedPricingModel),
    defaultPricingModel: settings.defaultPricingModel || "",
  };
}
