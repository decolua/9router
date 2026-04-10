import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { getProviderConnections, getCombos } from "@/lib/localDb";
import { extractApiKey, getActiveApiKey, isApiKeyAllowedForModelOrNoKey } from "@/sse/services/auth";

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

// Matches provider IDs that are upstream/cross-instance connections (contain a UUID suffix)
const UPSTREAM_CONNECTION_RE = /[-_][0-9a-f]{8,}$/i;
const MODELS_DEV_URLS = (process.env.MODELS_DEV_URLS || "https://models.dev/api.json,https://models.dev/models.json")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
// Default cache TTL: 6 hours
const MODELS_DEV_CACHE_TTL_MS = Number.parseInt(process.env.MODELS_DEV_CACHE_TTL_MS, 10) || (6 * 60 * 60 * 1000);
const MODELS_DEV_TIMEOUT_MS = Number.parseInt(process.env.MODELS_DEV_TIMEOUT_MS, 10) || 7000;
const MODELS_DEV_MAX_PARSE_DEPTH = Number.parseInt(process.env.MODELS_DEV_MAX_PARSE_DEPTH, 10) || 6;

let modelsDevCache = null;

const normalizeModelsDevModelId = (modelId) => {
  if (typeof modelId !== "string") return "";
  return modelId
    .trim()
    .replace(/^models\//i, "")
    .toLowerCase();
};

const parseNumericValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const firstDefinedNumber = (...values) => {
  for (const value of values) {
    const parsed = parseNumericValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const hasAnyTokenMetadata = ({ contextWindow, inputTokenLimit, outputTokenLimit }) =>
  contextWindow !== undefined || inputTokenLimit !== undefined || outputTokenLimit !== undefined;

const collectModelsDevRecords = (value, records, depth = 0) => {
  if (depth >= MODELS_DEV_MAX_PARSE_DEPTH || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectModelsDevRecords(item, records, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  const hasModelLikeId = typeof value.id === "string" || typeof value.model === "string" || typeof value.name === "string";
  if (hasModelLikeId) records.push(value);

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      collectModelsDevRecords(nested, records, depth + 1);
    }
  }
};

const buildModelsDevIndex = (payload) => {
  const records = [];
  const index = new Map();

  collectModelsDevRecords(payload, records);

  for (const record of records) {
    const rawId = record?.id || record?.model || record?.name;
    const normalizedId = normalizeModelsDevModelId(rawId);
    if (!normalizedId) continue;

    const tokenInfo = record?.tokens && typeof record.tokens === "object" ? record.tokens : {};
    const contextWindow = firstDefinedNumber(
      record?.context_window,
      record?.contextWindow,
      record?.context_length,
      record?.contextLength,
      record?.contextSize,
      record?.context_size,
      tokenInfo?.context_window,
      tokenInfo?.contextWindow,
      tokenInfo?.context_length,
      tokenInfo?.contextLength
    );
    const inputTokenLimit = firstDefinedNumber(
      record?.input_token_limit,
      record?.inputTokenLimit,
      record?.max_input_tokens,
      record?.maxInputTokens,
      record?.input_tokens,
      record?.inputTokens,
      tokenInfo?.input_token_limit,
      tokenInfo?.inputTokenLimit,
      tokenInfo?.max_input_tokens,
      tokenInfo?.maxInputTokens
    );
    const outputTokenLimit = firstDefinedNumber(
      record?.output_token_limit,
      record?.outputTokenLimit,
      record?.max_output_tokens,
      record?.maxOutputTokens,
      record?.max_completion_tokens,
      record?.maxCompletionTokens,
      record?.output_tokens,
      record?.outputTokens,
      tokenInfo?.output_token_limit,
      tokenInfo?.outputTokenLimit,
      tokenInfo?.max_output_tokens,
      tokenInfo?.maxOutputTokens,
      tokenInfo?.max_completion_tokens,
      tokenInfo?.maxCompletionTokens
    );

    if (!hasAnyTokenMetadata({ contextWindow, inputTokenLimit, outputTokenLimit })) continue;

    const metadata = {
      source: "models.dev",
      source_model_id: rawId,
      ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
      ...(inputTokenLimit !== undefined ? { max_input_tokens: inputTokenLimit } : {}),
      ...(outputTokenLimit !== undefined ? { max_output_tokens: outputTokenLimit } : {}),
    };

    const keyCandidates = new Set([normalizedId]);
    const slashIndex = normalizedId.lastIndexOf("/");
    if (slashIndex > -1 && slashIndex < normalizedId.length - 1) {
      keyCandidates.add(normalizedId.slice(slashIndex + 1));
    }

    for (const key of keyCandidates) {
      if (!index.has(key)) {
        index.set(key, metadata);
      }
    }
  }

  return index;
};

async function fetchModelsDevIndex() {
  const now = Date.now();
  if (modelsDevCache && now < modelsDevCache.expiresAt) {
    return modelsDevCache.index;
  }

  const staleIndex = modelsDevCache?.index;

  for (const url of MODELS_DEV_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = await response.json();
      const index = buildModelsDevIndex(data);
      if (index.size === 0) continue;

      modelsDevCache = {
        index,
        expiresAt: now + MODELS_DEV_CACHE_TTL_MS,
      };
      return index;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[v1/models] models.dev fetch failed (${url}):`, error?.message || error);
      }
      continue;
    }
  }

  return staleIndex || new Map();
}

const findModelsDevMetadata = (modelsDevIndex, modelId) => {
  if (!modelsDevIndex || modelsDevIndex.size === 0 || typeof modelId !== "string") return null;

  const normalized = normalizeModelsDevModelId(modelId);
  if (!normalized) return null;

  const keyCandidates = [normalized];
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex > -1 && slashIndex < normalized.length - 1) {
    keyCandidates.push(normalized.slice(slashIndex + 1));
  }

  for (const key of keyCandidates) {
    const metadata = modelsDevIndex.get(key);
    if (metadata) return metadata;
  }

  return null;
};

const enrichModelsWithModelsDevMetadata = (models, modelsDevIndex) =>
  models.map((model) => {
    const metadata = findModelsDevMetadata(modelsDevIndex, model?.root || model?.id);
    if (!metadata) return model;
    return {
      ...model,
      ...metadata,
      ...(metadata.context_window !== undefined ? { token_size: metadata.context_window } : {}),
    };
  });

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

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

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list
 * Returns models from all active providers and combos in OpenAI format
 */
export async function GET(request) {
  try {
    const modelsDevIndex = await fetchModelsDevIndex();
    const apiKey = extractApiKey(request);
    const apiKeyRecord = apiKey ? await getActiveApiKey(apiKey) : null;
    const hasAccessRestrictions = Boolean(
      apiKeyRecord && (
        (apiKeyRecord.accessRules?.providers || []).length > 0
        || (apiKeyRecord.accessRules?.models || []).length > 0
      )
    );

    // Get active provider connections
    let connections = [];
    try {
      connections = await getProviderConnections();
      // Filter to only active connections
      connections = connections.filter(c => c.isActive !== false);
    } catch (e) {
      // If database not available, return all models
      console.log("Could not fetch providers, returning all models");
    }

    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos");
    }

    // Build first active connection per provider (connections already sorted by priority)
    const activeConnectionByProvider = new Map();
    for (const conn of connections) {
      if (!activeConnectionByProvider.has(conn.provider)) {
        activeConnectionByProvider.set(conn.provider, conn);
      }
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    // Add combos first (they appear at the top)
    for (const combo of combos) {
      if (hasAccessRestrictions) continue;
      models.push({
        id: combo.name,
        object: "model",
        created: timestamp,
        owned_by: "combo",
        permission: [],
        root: combo.name,
        parent: null,
      });
    }

    // Add provider models
    if (connections.length === 0) {
      // DB unavailable or no active providers -> return all static models
      for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
        for (const model of providerModels) {
          models.push({
            id: `${alias}/${model.id}`,
            object: "model",
            created: timestamp,
            owned_by: alias,
            permission: [],
            root: model.id,
            parent: null,
          });
        }
      }
    } else {
      for (const [providerId, conn] of activeConnectionByProvider.entries()) {
        const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
        const outputAlias = (
          conn?.providerSpecificData?.prefix
          || getProviderAlias(providerId)
          || staticAlias
        ).trim();
        const providerModels = PROVIDER_MODELS[staticAlias] || [];
        const enabledModels = conn?.providerSpecificData?.enabledModels;
        const hasExplicitEnabledModels =
          Array.isArray(enabledModels) && enabledModels.length > 0;
        const isCompatibleProvider =
          isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

        // Default: if no explicit selection, all static models are active.
        // For compatible providers with no explicit selection, fetch remote /models dynamically.
        // If explicit selection exists, expose exactly those model IDs (including non-static IDs).
        let rawModelIds = hasExplicitEnabledModels
          ? Array.from(
              new Set(
                enabledModels.filter(
                  (modelId) => typeof modelId === "string" && modelId.trim() !== "",
                ),
              ),
            )
          : providerModels.map((model) => model.id);

        if (isCompatibleProvider && rawModelIds.length === 0 && !UPSTREAM_CONNECTION_RE.test(providerId)) {
          rawModelIds = await fetchCompatibleModelIds(conn);
        }

        const modelIds = rawModelIds
          .map((modelId) => {
            if (modelId.startsWith(`${outputAlias}/`)) {
              return modelId.slice(outputAlias.length + 1);
            }
            if (modelId.startsWith(`${staticAlias}/`)) {
              return modelId.slice(staticAlias.length + 1);
            }
            if (modelId.startsWith(`${providerId}/`)) {
              return modelId.slice(providerId.length + 1);
            }
            return modelId;
          })
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

        for (const modelId of modelIds) {
          if (apiKeyRecord && !isApiKeyAllowedForModelOrNoKey(apiKeyRecord, providerId, modelId)) {
            continue;
          }
          models.push({
            id: `${outputAlias}/${modelId}`,
            object: "model",
            created: timestamp,
            owned_by: outputAlias,
            permission: [],
            root: modelId,
            parent: null,
          });
        }
      }
    }

    return Response.json({
      object: "list",
      data: enrichModelsWithModelsDevMetadata(models, modelsDevIndex),
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
