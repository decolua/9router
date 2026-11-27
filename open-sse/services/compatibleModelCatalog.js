import { isOpenAICompatible } from "./provider.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";
const CACHE_TTL_MS = 60_000;
const MAX_CONNECTIONS = 128;
const cache = new Map();

async function loadModels(baseUrl, apiKey, proxyOptions) {
  try {
    const options = {
      headers: {
        [INTERNAL_MODELS_FETCH_HEADER]: "1",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    };
    const url = `${baseUrl}/models`;
    const useConnectionProxy = proxyOptions?.connectionProxyEnabled || proxyOptions?.vercelRelayUrl || proxyOptions?.strictProxy;
    const response = useConnectionProxy ? await proxyAwareFetch(url, options, proxyOptions) : await fetch(url, options);
    if (!response.ok) return [];
    const data = await response.json();
    const models = Array.isArray(data) ? data : data?.data || data?.models || data?.results;
    if (!Array.isArray(models)) return [];
    return models.flatMap((model) => {
      const id = model?.id || model?.name || model?.model;
      if (typeof id !== "string" || !id.trim()) return [];
      const inputs = model.architecture?.input_modalities;
      return [{ id, ...(Array.isArray(inputs) ? { vision: inputs.includes("image") } : {}) }];
    });
  } catch {
    return [];
  }
}

export async function getCompatibleModelCatalog(provider, credentials, proxyOptions) {
  if (!isOpenAICompatible(provider)) return [];
  const baseUrl = credentials?.providerSpecificData?.baseUrl;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return [];
  const url = baseUrl.trim().replace(/\/$/, "");
  const key = credentials.connectionId || credentials.id;
  if (!key) return loadModels(url, credentials.apiKey, proxyOptions);
  const found = cache.get(key);
  if (found?.url === url && found.apiKey === credentials.apiKey && found.expiresAt > Date.now()) {
    return found.models;
  }
  if (cache.size >= MAX_CONNECTIONS) cache.delete(cache.keys().next().value);
  const models = loadModels(url, credentials.apiKey, proxyOptions);
  cache.set(key, { url, apiKey: credentials.apiKey, expiresAt: Date.now() + CACHE_TTL_MS, models });
  return models;
}
