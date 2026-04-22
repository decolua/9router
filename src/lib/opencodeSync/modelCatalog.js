import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { getCombos, getProviderConnections } from "@/lib/localDb";

const UPSTREAM_CONNECTION_RE = /[-_][0-9a-f]{8,}$/i;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseOpenAIStyleModels(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

function buildCatalogEntry(modelId, ownedBy = "", source = null) {
  const [providerPrefix, ...rest] = modelId.split("/");
  const root = rest.join("/") || modelId;
  const provider = ownedBy || providerPrefix || "";
  const sourceModel = source && typeof source === "object" && !Array.isArray(source) ? source : {};

  return {
    id: modelId,
    name:
      typeof sourceModel.name === "string" && sourceModel.name.trim()
        ? sourceModel.name.trim()
        : typeof sourceModel.label === "string" && sourceModel.label.trim()
          ? sourceModel.label.trim()
          : modelId,
    ...(typeof sourceModel.label === "string" && sourceModel.label.trim() ? { label: sourceModel.label.trim() } : {}),
    provider,
    root,
    owned_by: provider,
    object: "model",
    ...(sourceModel.contextWindow != null ? { contextWindow: sourceModel.contextWindow } : {}),
    ...(sourceModel.maxInputTokens != null ? { maxInputTokens: sourceModel.maxInputTokens } : {}),
    ...(sourceModel.maxOutputTokens != null ? { maxOutputTokens: sourceModel.maxOutputTokens } : {}),
    ...(sourceModel.inputCost != null ? { inputCost: sourceModel.inputCost } : {}),
    ...(sourceModel.outputCost != null ? { outputCost: sourceModel.outputCost } : {}),
    ...(Array.isArray(sourceModel.tags) ? { tags: [...sourceModel.tags] } : {}),
    ...(Array.isArray(sourceModel.capabilities) ? { capabilities: [...sourceModel.capabilities] } : {}),
  };
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = normalizeString(connection?.providerSpecificData?.baseUrl).replace(/\/$/, "");
  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

async function list9RouterModelsInternal() {
  let connections = [];
  try {
    connections = await getProviderConnections();
    connections = connections.filter((connection) => connection.isActive !== false);
  } catch {
    connections = [];
  }

  let combos = [];
  try {
    combos = await getCombos();
  } catch {
    combos = [];
  }

  const models = [];

  for (const combo of combos) {
    const comboName = normalizeString(combo?.name);
    if (!comboName) continue;
    models.push(buildCatalogEntry(comboName, "combo", combo));
  }

  if (connections.length === 0) {
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        const rootId = normalizeString(model?.id);
        if (!rootId) continue;
        models.push(buildCatalogEntry(`${alias}/${rootId}`, alias, model));
      }
    }

    return models;
  }

  const activeConnectionByProvider = new Map();
  for (const connection of connections) {
    if (!activeConnectionByProvider.has(connection.provider)) {
      activeConnectionByProvider.set(connection.provider, connection);
    }
  }

  for (const [providerId, connection] of activeConnectionByProvider.entries()) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const outputAlias = normalizeString(connection?.providerSpecificData?.prefix) || getProviderAlias(providerId) || staticAlias;
    const providerModels = PROVIDER_MODELS[staticAlias] || [];
    const enabledModels = connection?.providerSpecificData?.enabledModels;
    const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
    const isCompatibleProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    let rawModelIds = hasExplicitEnabledModels
      ? Array.from(
          new Set(enabledModels.filter((modelId) => typeof modelId === "string" && modelId.trim() !== ""))
        )
      : providerModels.map((model) => model.id);

    if (isCompatibleProvider && rawModelIds.length === 0 && !UPSTREAM_CONNECTION_RE.test(providerId)) {
      rawModelIds = await fetchCompatibleModelIds(connection);
    }

    const modelIds = rawModelIds
      .map((modelId) => {
        if (modelId.startsWith(`${outputAlias}/`)) return modelId.slice(outputAlias.length + 1);
        if (modelId.startsWith(`${staticAlias}/`)) return modelId.slice(staticAlias.length + 1);
        if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
        return modelId;
      })
      .map((modelId) => normalizeString(modelId))
      .filter(Boolean);

    for (const modelId of modelIds) {
      const staticModel = providerModels.find((model) => normalizeString(model?.id) === modelId) || null;
      models.push(buildCatalogEntry(`${outputAlias}/${modelId}`, outputAlias, staticModel));
    }
  }

  return models;
}

export async function load9RouterModelCatalog() {
  const models = await list9RouterModelsInternal();

  return models.reduce((result, model) => {
    const modelId = normalizeString(model?.id);
    if (!modelId) return result;

    result[modelId] = {
      ...model,
      id: modelId,
    };
    return result;
  }, {});
}
