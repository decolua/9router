// Generic models-listing support for providers without an explicit
// PROVIDER_MODELS_CONFIG entry in src/app/api/providers/[id]/models/route.js.
// Derives a models endpoint from the provider's registry entry:
// `modelsFetcher.url` wins, otherwise an OpenAI-style `<base>/chat/completions`
// (or Anthropic-style `<base>/messages`) baseUrl maps to `<base>/models`.
import REGISTRY from "open-sse/providers/registry/index.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

export const getRegistryEntry = (providerId) =>
  REGISTRY.find((r) => r.id === providerId);

export const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

export const getStaticProviderModels = (providerId) =>
  getModelsByProviderId(providerId).map((model) => ({
    ...model,
    id: model.id,
    name: model.name || model.id,
  }));

// Catalog aggregators (models.dev) return a `{ providerId: { models } }` map,
// not an OpenAI-style flat list — a modelsFetcher pointing there is unusable
// for live import, so skip it and fall through to baseUrl derivation.
const isCatalogAggregatorUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "models.dev" || hostname.endsWith(".models.dev");
  } catch {
    return false;
  }
};

/**
 * Derive a models-listing endpoint for a registry entry.
 * @param {object} entry - provider registry entry (open-sse/providers/registry)
 * @returns {{ url: string, style: "openai" | "anthropic" } | null}
 */
export function deriveModelsEndpoint(entry) {
  if (!entry) return null;
  const kinds = entry.serviceKinds ?? ["llm"];
  if (!kinds.includes("llm")) return null;
  if (entry.modelsFetcher?.url && !isCatalogAggregatorUrl(entry.modelsFetcher.url)) {
    return { url: entry.modelsFetcher.url, style: "openai" };
  }
  const baseUrl = entry.transport?.baseUrl;
  if (typeof baseUrl !== "string" || !baseUrl.startsWith("http")) return null;
  if (baseUrl.includes("{")) return null; // unresolved placeholder (e.g. cloudflare {accountId})
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return { url: `${trimmed.slice(0, -"/chat/completions".length)}/models`, style: "openai" };
  }
  if (trimmed.endsWith("/messages")) {
    return { url: `${trimmed.slice(0, -"/messages".length)}/models`, style: "anthropic" };
  }
  return null;
}

/**
 * Best-effort live fetch through a derived endpoint; on any failure falls back
 * to the provider's static catalog with a warning (never throws).
 * @param {{ url: string, style: "openai" | "anthropic" }} endpoint
 * @param {object} connection - provider connection (apiKey / accessToken)
 * @returns {Promise<{ models: object[], warning?: string }>}
 */
export async function fetchViaDerivedEndpoint(endpoint, connection) {
  const token = connection.apiKey || connection.accessToken;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    if (endpoint.style === "anthropic") {
      headers["x-api-key"] = token;
      headers["anthropic-version"] = "2023-06-01";
    }
  }
  try {
    const response = await fetch(endpoint.url, { method: "GET", headers });
    if (response.ok) {
      const data = await response.json();
      const models = parseOpenAIStyleModels(data);
      if (models.length) return { models };
    }
  } catch (error) {
    console.log(`Derived models endpoint failed for ${connection.provider} (falling back to static):`, error.message);
  }
  return {
    models: getStaticProviderModels(connection.provider),
    warning: `Failed to fetch live models from ${endpoint.url}; falling back to static catalog.`,
  };
}
