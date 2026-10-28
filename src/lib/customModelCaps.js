import { getCustomModels } from "@/lib/db/index.js";

// Custom model ids are scoped by provider, so an override for one account's
// model must never leak into a different upstream with the same model id.
export function findCustomModelCaps(models, aliases, modelId) {
  const entry = models.find((model) => aliases.includes(model.providerAlias) && model.id === modelId && (!model.type || model.type === "llm"));
  return entry?.caps && typeof entry.caps === "object" ? entry.caps : null;
}

export async function getCustomModelCaps(aliases, modelId) {
  try {
    return findCustomModelCaps(await getCustomModels(), aliases, modelId);
  } catch {
    // Custom capability metadata is optional; DB failures must not block routing.
    return null;
  }
}
