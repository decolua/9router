import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getCapabilitiesForModel, PROVIDER_CAPABILITIES } from "open-sse/providers/capabilities.js";

const CATALOG_TTL_MS = 60_000;
const UNAVAILABLE_IDS = new Set(["deepseek-v4-flash-free"]);
let catalog;

async function fetchModels() {
  const provider = AI_PROVIDERS.opencode;
  try {
    const response = await fetch(provider.modelsFetcher.url, {
      headers: { "x-opencode-client": "desktop" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const raw = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : [];
    return raw.flatMap((model) => {
      const id = model?.id || model?.name;
      if (typeof id !== "string" || (id !== "big-pickle" && !id.endsWith("-free")) || UNAVAILABLE_IDS.has(id)) return [];

      const capabilities = getCapabilitiesForModel("opencode", id);
      const verified = PROVIDER_CAPABILITIES.opencode[id];
      // Exact provider overrides reflect gateway limits verified against the backend.
      // For other models, prefer the advertised limits to generic capability guesses.
      if (Number.isFinite(model.limit?.context) && model.limit.context > 0 && verified?.contextWindow == null) {
        capabilities.contextWindow = model.limit.context;
      }
      if (Number.isFinite(model.limit?.output) && model.limit.output > 0 && verified?.maxOutput == null) {
        capabilities.maxOutput = model.limit.output;
      }
      if (model.capabilities?.reasoning?.supported) capabilities.reasoning = true;
      if (model.capabilities?.tools?.supported) capabilities.tools = true;
      return [{ id, name: model.name || id, capabilities }];
    });
  } catch {
    return [];
  }
}

export function resolveOpenCodeFreeModels() {
  if (!catalog || catalog.expiresAt <= Date.now()) {
    catalog = { models: fetchModels(), expiresAt: Date.now() + CATALOG_TTL_MS };
  }
  return catalog.models;
}
