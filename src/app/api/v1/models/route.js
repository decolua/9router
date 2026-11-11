import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import { resolveModelDisplayName } from "@/shared/utils/modelDisplayName";

export const dynamic = "force-dynamic";
import {
  AI_PROVIDERS,
  FREE_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases, getStudioModels } from "@/lib/localDb";
import { getAllowedModelsOfKey, matchesAllowedModels } from "@/lib/db/repos/apiKeysRepo.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { buildStudioTargetIndex } from "@/shared/utils/studioModelVisibility";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels, routableQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels, resolveClineModels } from "open-sse/services/clinepassModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { resolveZedModels } from "open-sse/shared/zedAuth.js";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { capabilitiesFromServiceKind, getCapabilitiesForModel, aggregateComboCapabilities } from "open-sse/providers/capabilities.js";
import { fetchSuggestedModelsServer, onlyFree } from "@/app/api/providers/suggested-models/filters.js";

// Qoder shares one live resolver across intl (qoder) and CN (qoder-cn); the
// credentials carry the provider id so qoderModels picks the right region's
// catalog endpoint.
async function resolveQoderLiveModels(conn, provider) {
  const result = await resolveQoderModels({
    provider,
    accessToken: conn.accessToken,
    // PAT (pt-...) connections keep the token in apiKey; without it the live
    // catalog silently fails and /v1/models falls back to the static list.
    apiKey: conn.apiKey,
    refreshToken: conn.refreshToken,
    email: conn.email,
    displayName: conn.displayName,
    providerSpecificData: conn.providerSpecificData || {}
  });
  // Visible + hidden (enable:false) catalog keys - chat routes all of them.
  const models = routableQoderModels(result);
  if (!models.length) return null;
  return { models: models.map((m) => ({ id: m.id, name: m.name })) };
}

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
const LIVE_MODEL_RESOLVERS = {
  anthropic: async (conn) => {
    if (!conn.apiKey) return null;
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": conn.apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`anthropic /v1/models ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).filter((m) => m?.id).map((m) => ({ id: m.id, name: m.display_name || m.id }));
    return models.length ? { models } : null;
  },
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => resolveQoderLiveModels(conn, "qoder"),
  "qoder-cn": async (conn) => resolveQoderLiveModels(conn, "qoder-cn"),
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, {
      log: console,
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cline: async (conn) => {
    const result = await resolveClineModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    }, {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  zed: async (conn) => {
    const result = await resolveZedModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models
        .filter((m) => !m.isDisabled)
        .map((m) => ({
          id: m.id,
          name: m.name,
          capabilities: m.supportsTools ? { tools: true } : undefined,
        })),
    };
  },
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

// Header sent by fetchCompatibleModelIds to detect cross-instance /models fetches
// and break recursive loops between 9router instances connected to each other.
const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

// LLM kind sentinel - combos/models with no explicit kind default to LLM
const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  video: "video",
};

function modelKind(model) {
  const k = model?.kind || model?.type;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] || LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

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
      headers: { ...headers, [INTERNAL_MODELS_FETCH_HEADER]: "1" },
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

// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Providers that need no credential are callable the moment 9Router runs, so they
// never own a connection row. Without this pass they only appeared while the whole
// provider table was empty, and any client that reads /v1/models (Hermes, Cline,
// SDK model pickers) could not see a single one of their models.
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(
  (id) => FREE_PROVIDERS[id].noAuth && !FREE_PROVIDERS[id].hidden
);

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

/** The caller's API key, from either header; empty when the request carries none. */
function readCallerApiKey(request) {
 const auth = String(request?.headers?.get("authorization") || "");
 const bearer = auth.match(/^Bearer\s+(.+)$/i);
 return (bearer?.[1] || request?.headers?.get("x-api-key") || "").trim() || null;
}

// Drop a routing prefix (`alias/upstream-id` stored in enabledModels or aliases)
// so the published id is `alias/upstream-id` once. LLMTR's own catalog ids are
// `llmtr/<name>` (one segment after the vendor). That first `llmtr/` is the
// upstream id, not a route prefix — unwrapping it would publish `llmtr/qwen3-8-27b`
// and the chat parser would send `qwen3-8-27b`. Unwrap only a second copy
// (`llmtr/llmtr/<name>`) or a prefix in front of a namespaced id (`llmtr/qwen/...`).
function unwrapListedModelId(modelId, outputAlias, staticAlias, providerId) {
  if (typeof modelId !== "string") return modelId;
  const prefixes = [outputAlias, staticAlias, providerId];
  for (const prefix of prefixes) {
    if (!prefix || !modelId.startsWith(`${prefix}/`)) continue;
    const rest = modelId.slice(prefix.length + 1);
    if (providerId === "llmtr" && prefix === "llmtr") {
      if (rest.startsWith("llmtr/")) return rest;
      if (!rest.includes("/")) return modelId;
    }
    return rest;
  }
  return modelId;
}

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter, options = {}) {
 // A restricted API key only ever sees the models it may actually call, so the
 // listing can never promise a model the request gate would refuse.
 const callerPatterns = await getAllowedModelsOfKey(readCallerApiKey(options.request));
 // When this header is present, the /v1/models request came from another
 // 9router instance's fetchCompatibleModelIds - skip dynamic fetch to break
 // cross-instance recursive loops.
 const skipDynamicFetch = options.skipDynamicFetch === true;
  let connections = [];
  try {
    connections = await getProviderConnections();
    connections = connections.filter(c => c.isActive !== false);
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = await getCombos();
  } catch (e) {
    console.log("Could not fetch combos");
  }

  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  let modelAliases = {};
  try {
    modelAliases = await getModelAliases();
  } catch (e) {
    console.log("Could not fetch model aliases");
  }

  
  let studioModels = [];
  try {
    studioModels = await getStudioModels();
  } catch (e) {
    console.log("Could not fetch model studio models");
  }
  // Studio names are records of their own now; a leftover alias carrying one would
  // list the same model twice under two different names.
  const studioNames = new Set(studioModels.map((s) => String(s.callName).toLowerCase()));
 let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  // A studio name hides the model it points at, everywhere it would be listed.
  const studioTargets = buildStudioTargetIndex(studioModels);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  // Include no-auth free providers (e.g. opencode) so their models are exposed in /v1/models
  for (const [id, provider] of Object.entries(FREE_PROVIDERS || {})) {
    if (provider?.noAuth && !activeConnectionByProvider.has(id)) {
      activeConnectionByProvider.set(id, {
        id: "noauth",
        provider: id,
        isActive: true,
      });
    }
  }

  const models = [];

  // Lookup map so aggregateComboCapabilities can recursively resolve nested combos
  const comboByName = Object.fromEntries(combos.map((c) => [c.name, c.models]));

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    // `name` is derived: combos are identified by their name (which is the id),
    // and clients render model names as-is when the field is missing.
    const entry = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
      name: resolveModelDisplayName(combo.name),
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    } else {
      const comboCaps = aggregateComboCapabilities(combo.models, comboByName, null, 0, Number(combo.contextWindow) || 0);
      if (comboCaps) {
        entry.capabilities = comboCaps;
        // Same reason single models publish it: a client that only reads
        // context_length must not fall back to guessing the window from the name.
        if (Number.isFinite(comboCaps.contextWindow)) entry.context_length = comboCaps.contextWindow;
        if (Number.isFinite(comboCaps.maxOutput)) entry.max_completion_tokens = comboCaps.maxOutput;
      }
    }
    models.push(entry);
  }
  
  // Custom model (studio) names are user-defined callable IDs (alias + per-model overrides).
  for (const studio of studioModels) {
    if (!kindFilter.includes(LLM_KIND)) continue;
    // A studio model is a name the client calls. It routes to studio.targetModel,
    // but the catalogue must not name that target: publishing resolved_model (or a
    // fixed owned_by) let anyone listing models see that "claude-opus-5-5" is really
    // mimo-v2.5. owned_by is the studio's own label for itself, free-form, defaulting
    // to the callable name so a client reads back exactly what it asked for.
    const entry = {
      id: studio.callName,
      object: "model",
      owned_by: studio.ownedBy || studio.callName,
    };
    const caps = getCapabilitiesForModel(studio.provider, studio.model);
    if (caps) entry.capabilities = caps;
    const contextWindow = Number(studio.contextWindow) || caps?.contextWindow;
    if (Number.isFinite(contextWindow)) entry.context_length = contextWindow;
    if (Number.isFinite(caps?.maxOutput)) entry.max_completion_tokens = caps.maxOutput;
    models.push(entry);
  }

  if (connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.includes(modelKind(model))) continue;
        if (isDisabled(alias, model.id) || isDisabled(providerId, model.id)) continue;
        if (studioTargets.isStudioTarget([providerId, alias], model.id)) continue;
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          owned_by: alias,
          name: resolveModelDisplayName(model.id, model.name),
          capabilities: getCapabilitiesForModel(alias, model.id),
        });
      }
    }

    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      // Custom models without active connection are LLM-only by current schema
      if (!kindFilter.includes(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;
      if (studioTargets.isStudioTarget(providerAlias, modelId)) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        // Optional operator-set label, exactly as for studio models; falls back
        // to the provider alias so an unset field changes nothing.
        owned_by: customModel.ownedBy || providerAlias,
        name: resolveModelDisplayName(modelId, customModel.name),
      });
    }
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      if (!providerMatchesKinds(providerId, kindFilter)) continue;

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

      // Build kind lookup for static models so we can filter even when only IDs are exposed
      const staticModelKindById = new Map(
        providerModels.map((m) => [m.id, modelKind(m)])
      );
      // Registry entries publish a human name for most models; keep it for the
      // entries below instead of making clients render the raw id.
      const staticModelNameById = new Map(
        providerModels.filter((m) => m?.id).map((m) => [m.id, m.name])
      );
      let liveModelKindById = new Map();
      let liveModelNameById = new Map();
      let liveCapabilitiesById = new Map();

      let rawModelIds = hasExplicitEnabledModels
        ? Array.from(
            new Set(
              enabledModels.filter(
                (modelId) => typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
        : providerModels.map((model) => model.id);

      if (isCompatibleProvider && rawModelIds.length === 0 && !skipDynamicFetch) {
        rawModelIds = await fetchCompatibleModelIds(conn);
      }

      // Config-driven live catalog override (e.g. Kiro returns dynamic
      // -thinking/-agentic variants per account). On failure, fall back to
      // whatever rawModelIds already holds.
      const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
      if (liveResolver && !hasExplicitEnabledModels) {
        try {
          const live = await liveResolver(conn);
          if (live?.models?.length) {
            rawModelIds = live.models.map((m) => m.id);
            liveModelKindById = new Map(
              live.models
                .filter((m) => m?.id)
                .map((m) => [m.id, modelKind(m)])
            );
            liveModelNameById = new Map(
              live.models
                .filter((m) => m?.id && typeof m.name === "string")
                .map((m) => [m.id, m.name])
            );
            liveCapabilitiesById = new Map(
              live.models
                .filter((m) => m?.id && m.capabilities)
                .map((m) => [m.id, m.capabilities])
            );
          }
        } catch (err) {
          console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
        }
      }

      const modelIds = rawModelIds
        .map((modelId) => unwrapListedModelId(modelId, outputAlias, staticAlias, providerId))
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      const customModelKindById = new Map();
      const customModelNameById = new Map();
      const customModelIds = customModels
        .filter((m) => {
          if (!m?.id) return false;
          const kind = getModelKind(m) || LLM_KIND;
          // imageToText custom models are vision-capable chat models: expose them
          // both in the default LLM list and in /v1/models/image-to-text.
          if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        })
        .map((m) => {
          const modelId = String(m.id).trim();
          if (modelId) customModelKindById.set(modelId, getModelKind(m) || LLM_KIND);
          if (modelId && typeof m.name === "string") customModelNameById.set(modelId, m.name);
          return modelId;
        })
        .filter((modelId) => modelId !== "");

      const aliasModelIds = Object.entries(modelAliases || {})
 .filter(([aliasName]) => !studioNames.has(String(aliasName).toLowerCase()))
 .map(([, fullModel]) => fullModel)
        .filter((fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
          return (
            fullModel.startsWith(`${outputAlias}/`) ||
            fullModel.startsWith(`${staticAlias}/`) ||
            fullModel.startsWith(`${providerId}/`)
          );
        })
        .map((fullModel) => unwrapListedModelId(fullModel, outputAlias, staticAlias, providerId))
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      // The same filter produced customModelIds; remember which of them carry an
      // operator-owned label so the merged entry can publish it below.
      const customOwnedByById = new Map();
      for (const m of customModels) {
        if (!m?.id || !m.ownedBy) continue;
        const alias = m.providerAlias;
        if (alias === staticAlias || alias === outputAlias || alias === providerId) {
          const modelId = String(m.id).trim();
          if (modelId) customOwnedByById.set(modelId, m.ownedBy);
        }
      }

      const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));

      for (const modelId of mergedModelIds) {
        // Resolve kind: prefer custom/live metadata, then static, then ID heuristics.
        const customKind = customModelKindById.get(modelId);
        const liveKind = liveModelKindById.get(modelId);
        const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        // imageToText custom models stay in the LLM list (vision-capable chat models)
        const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
        if (!kindFilter.includes(kind) && !allowAsLlm) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId) || isDisabled(providerId, modelId)) continue;
        // Hidden behind a studio name: only the studio name is published.
        if (studioTargets.isStudioTarget([providerId, staticAlias, outputAlias], modelId)) continue;

        const customName = customModelNameById.get(modelId);
        const staticName = staticModelNameById.get(modelId);
        const liveName = liveModelNameById.get(modelId);
        const candidateName = (customName && customName !== modelId)
          ? customName
          : (liveName || staticName || customName);

        const model = {
          id: `${outputAlias}/${modelId}`,
          object: "model",
          // Optional label the operator set on this custom model; the provider
          // alias stays the default so an unset field changes nothing.
          owned_by: customOwnedByById.get(modelId) || outputAlias,
          // Prefer the name the provider/custom entry published; ids with none
          // (combos, raw passthrough slugs) get a readable name derived from it.
          name: resolveModelDisplayName(modelId, candidateName),
        };
        // Live-catalog resolvers (kiro/qoder/github/clinepass) mostly only return
        // { id, name } - no per-model capability data. Fall back to the same
        // pattern-matched capabilities the dashboard uses (useModelCaps.js) so
        // dynamically-discovered LLM models still surface vision/reasoning/search/tools.
        const liveCaps = liveCapabilitiesById.get(modelId);
        const serviceCaps = capabilitiesFromServiceKind(customKind || liveKind);
        const caps = liveCaps || serviceCaps || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
        if (caps) model.capabilities = caps;
        if (isOpencodeFreeModel(modelId, outputAlias)) {
          model.is_free = true;
          model.isFree = true;
        }
        // Token limits under the snake_case names the OpenAI/OpenRouter
        // convention uses. `capabilities.contextWindow` is camelCase and nested,
        // so clients matching context_length find nothing, fall back to guessing
        // the window from the model name, and guess high - a 372k model read as
        // 1.05M never reaches its compaction threshold and hard-fails upstream.
        // Emitted at top level because not every client recurses into nested
        // objects; the camelCase `capabilities` block stays for compatibility.
        if (kind === LLM_KIND || allowAsLlm) {
          let contextWindow = caps?.contextWindow;
          let maxOutput = caps?.maxOutput;
          // Live-catalog and service-kind capabilities are usually partial
          // (often just { tools: true }), so fill the gaps from the static
          // table rather than emitting null and leaving clients to guess.
          if (!Number.isFinite(contextWindow) || !Number.isFinite(maxOutput)) {
            const fallback = getCapabilitiesForModel(providerId, modelId);
            if (!Number.isFinite(contextWindow)) contextWindow = fallback.contextWindow;
            if (!Number.isFinite(maxOutput)) maxOutput = fallback.maxOutput;
          }
          if (Number.isFinite(contextWindow)) model.context_length = contextWindow;
          if (Number.isFinite(maxOutput)) model.max_completion_tokens = maxOutput;
        }
        models.push(model);
      }

      // Web search/fetch - provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
      const providerInfo = AI_PROVIDERS[providerId];
      if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
        models.push({
          id: `${outputAlias}/search`,
          object: "model",
          kind: "webSearch",
          owned_by: outputAlias,
        });
      }
      if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
        models.push({
          id: `${outputAlias}/fetch`,
          object: "model",
          kind: "webFetch",
          owned_by: outputAlias,
        });
      }
    }
  }

  // Credential-free providers have no connection row to iterate, so list them here.
  // A provider that does have a live connection was already published above.
  for (const providerId of NO_AUTH_PROVIDER_IDS) {
    if (activeConnectionByProvider.has(providerId)) continue;
    if (!providerMatchesKinds(providerId, kindFilter)) continue;
    const alias = getProviderAlias(providerId);
    const providerModels = PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[providerId] || providerId] || [];
    for (const model of providerModels) {
      if (!kindFilter.includes(modelKind(model))) continue;
      if (isDisabled(alias, model.id)) continue;
      if (studioTargets.isStudioTarget([providerId, alias], model.id)) continue;
      const caps = getCapabilitiesForModel(providerId, model.id);
      const entry = {
        id: `${alias}/${model.id}`,
        object: "model",
        owned_by: alias,
        name: resolveModelDisplayName(model.id, model.name),
      };
      if (caps) entry.capabilities = caps;
      if (Number.isFinite(caps?.contextWindow)) entry.context_length = caps.contextWindow;
      if (Number.isFinite(caps?.maxOutput)) entry.max_completion_tokens = caps.maxOutput;
      if (model.isFree || isOpencodeFreeModel(model.id, alias)) {
        entry.is_free = true;
        entry.isFree = true;
      }
      models.push(entry);
    }
  }

  // Free no-auth providers publish a live catalogue (OpenCode Free changes weekly);
  // the registry table above is curated, so merge in whatever upstream lists now.
  // dedupedModels below drops ids already present, keeping registry order first.
  const liveFreeProviders = Object.entries(FREE_PROVIDERS).filter(
    ([, p]) => p.noAuth && !p.hidden && p.modelsFetcher
  );
  const liveFreeLists = await Promise.all(
    liveFreeProviders.map(async ([id, p]) => {
      const live = await fetchSuggestedModelsServer(p.modelsFetcher);
      return [p.alias || id, live];
    })
  );
  for (const [alias, liveModels] of liveFreeLists) {
    for (const live of onlyFree(liveModels)) {
      if (isDisabled(alias, live.id)) continue;
      const caps = getCapabilitiesForModel(alias, live.id);
      const entry = {
        id: `${alias}/${live.id}`,
        object: "model",
        owned_by: alias,
        name: resolveModelDisplayName(live.id, live.name),
      };
      if (caps) entry.capabilities = caps;
      if (Number.isFinite(caps?.contextWindow)) entry.context_length = caps.contextWindow;
      if (Number.isFinite(live?.contextLength) && !Number.isFinite(entry.context_length)) {
        entry.context_length = live.contextLength;
      }
      if (Number.isFinite(caps?.maxOutput)) entry.max_completion_tokens = caps.maxOutput;
      if (live?.isFree || isOpencodeFreeModel(live.id, alias)) {
        entry.is_free = true;
        entry.isFree = true;
      }
      models.push(entry);
    }
  }

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }

  // Same patterns the request gate applies: an unrestricted key still sees everything.
 if (!callerPatterns) return dedupedModels;
 return dedupedModels.filter((model) => matchesAllowedModels(callerPatterns, model.id));
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
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request) {
  try {
    const isInternal = request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const apiKey = readCallerApiKey(request);

    // Require an API key or dashboard auth so people cannot anonymously curl the model list
    if (!apiKey && !isInternal) {
      const cliToken = request?.headers?.get("x-9r-cli-token");
      const cookie = request?.headers?.get("cookie") || "";
      const isDashboardUser = Boolean(cliToken) || cookie.includes("auth_token=");
      if (!isDashboardUser) {
        return Response.json(
          {
            error: {
              message: "You must provide a valid API key to access this endpoint. Pass it via Authorization: Bearer <key> or x-api-key.",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    if (apiKey) {
      const { isValidApiKey } = await import("@/sse/services/auth.js");
      const valid = await isValidApiKey(apiKey, null);
      if (valid !== true && typeof valid !== "string") {
        return Response.json(
          {
            error: {
              message: "Invalid or expired API key.",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // Detect cross-instance recursive /models fetch (another 9router fetching our /models)
    const skipDynamicFetch = isInternal;
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch, request });
    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
