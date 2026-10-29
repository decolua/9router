import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import {
  ALIAS_TO_ID,
  AI_PROVIDERS,
  FREE_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";
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
  // Visible + hidden (enable:false) catalog keys — chat routes all of them.
  const models = routableQoderModels(result);
  if (!models.length) return null;
  return { models: models.map((m) => ({ id: m.id, name: m.name })) };
}

// Combo seats use UI aliases; the model registry also has transport aliases.
// Capability overrides and catalog limits are keyed by provider id.
const ALIAS_TO_PROVIDER_ID = {
  ...Object.fromEntries(
    Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
  ),
  ...ALIAS_TO_ID,
};

function comboSeatCapabilities(seat) {
  const slash = seat.indexOf("/");
  if (slash <= 0) return null;
  const alias = seat.slice(0, slash);
  return getCapabilitiesForModel(ALIAS_TO_PROVIDER_ID[alias] || alias, seat.slice(slash + 1));
}

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
const LIVE_MODEL_RESOLVERS = {
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
//
// Kept as the INBOUND rule, byte for byte: a request that carries it is a peer's
// internal fan-out, so this instance answers from its static view and does not
// fan out again. Old instances only know this header, so honouring it is what
// keeps a partially-upgraded federation terminating.
//
// It is deliberately NO LONGER sent on the outbound discovery fetch (see
// MODELS_FETCH_ORIGIN_HEADER): a 9router peer that sees this header answers with
// only its combos — it suppresses every model it learned from ITS nodes — which
// is how a node pointing at another 9router came back with a single id
// (DF-9ROUTER-35, measured live: 96 upstream ids -> 1 listed).
const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

// Cycle detection for the model discovery fetch, replacing the blanket marker on
// the outbound side. The instance whose /v1/models call started the chain puts its
// own process id here and forwards it unchanged down every hop; a chain that comes
// back to the originating process sees its own id and stops. A peer that fans out
// with this header still gets an answer (that is the point — its models are what
// the caller asked for), so a 9router upstream now lists its whole catalog while a
// node cycle still terminates.
const MODELS_FETCH_ORIGIN_HEADER = "x-9r-models-fetch-origin";

// Process-wide, not module-scoped: the server bundles this module into more than
// one chunk, and two copies would otherwise present two different identities for
// the same process — which would defeat the cycle check on the second copy.
function modelsFetchOriginId() {
  if (!globalThis.__9rModelsFetchOriginId) {
    globalThis.__9rModelsFetchOriginId =
      `9r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return globalThis.__9rModelsFetchOriginId;
}

// LLM kind sentinel — combos/models with no explicit kind default to LLM
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

// Reads a compatible node's own /models and returns the raw upstream ids.
// Returns null when the node has nothing to read from (no credential / no base
// URL / not a compatible provider) so the caller can tell "cannot look up" from
// "looked up and got nothing"; a failed or rejected lookup returns [].
async function fetchCompatibleModelIds(connection, { originId } = {}) {
  if (!connection?.apiKey) return null;

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return null;

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
    return null;
  }

  // Cycle detection only — this is NOT the internal-fetch marker. A 9router peer
  // that receives the marker answers with its combos alone (no models from its
  // own nodes), which is exactly the "one model instead of ninety" this task
  // fixes, so the marker must not ride the outbound discovery fetch.
  headers[MODELS_FETCH_ORIGIN_HEADER] = originId || modelsFetchOriginId();

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

    if (!response.ok) {
      console.log(
        `Compatible model listing failed for ${connection.provider} (${response.status} ${url}); keeping the configured list`,
      );
      return [];
    }

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch (err) {
    console.log(
      `Compatible model listing failed for ${connection.provider} (${err?.message || err}; ${url}); keeping the configured list`,
    );
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

// A provider is usable without a stored connection only when its registry entry
// declares `noAuth: true` — the same flag the chat/TTS/media handlers use to skip
// credential lookup (see src/sse/services/auth.js FREE_PROVIDERS check and the
// noAuth-derived CREDENTIALED_PROVIDERS set in src/sse/handlers/tts.js).
// Any other provider answers /v1 with 404 "No active credentials for provider"
// until a connection exists, so it must not be advertised as retrievable.
function providerIsCredentialless(providerId) {
  return AI_PROVIDERS[providerId]?.noAuth === true;
}

// `noAuth` alone can overstate usability: a provider may declare a
// credentialless path that only works from the VENDOR's own client
// (`requiresVendorClient`, e.g. opencode). Live probe 2026-09-17: opencode's
// /zen/v1/models answers 200 — so the catalog looks healthy — while
// /zen/v1/responses answers 403 FreeTierError "OpenCode's free tier can only be
// used from within OpenCode" even with the executor's own header set, and
// /zen/v1/chat/completions answers 401 "Missing API key.". No completion can be
// produced from this process, so such a provider is NOT usable without a stored
// connection and must not be advertised as retrievable on a fresh install.
// Both the list endpoint and the exact-model endpoint build their catalog
// through this module, so the refinement holds for both automatically.
function providerIsUsableWithoutCredentials(providerId) {
  return providerIsCredentialless(providerId)
    && AI_PROVIDERS[providerId]?.requiresVendorClient !== true;
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

// An id belongs to the node itself when it is already prefixed with the node's
// own prefix (or its node id / static alias). `/v1/models` re-adds that prefix,
// so such an entry must not be published as `${prefix}/${prefix}/${id}`.
function belongsToNode(modelId, { outputAlias, staticAlias, providerId }) {
  return modelId.startsWith(`${outputAlias}/`)
    || modelId.startsWith(`${staticAlias}/`)
    || modelId.startsWith(`${providerId}/`);
}

// Entries the upstream itself prefixes with the node's own prefix: a 9router
// upstream echoes the ids it was asked for, so a nested node added AFTER a
// listing was cached can answer with `${ourPrefix}/…`. Such an entry names a
// model the node does not define, but it is the only handle left once the
// upstream has dropped the one it did define, and dropping it is what turns a
// working node into an empty catalog. Kind-filter it like any other id.
function nodeOwnedUpstreamIds(rawModelIds, aliases) {
  const owned = [];
  for (const modelId of rawModelIds) {
    if (!belongsToNode(modelId, aliases)) continue;
    const stripped = stripNodePrefixes(modelId, aliases);
    if (stripped) owned.push(stripped);
  }
  return owned;
}

function stripNodePrefixes(modelId, { outputAlias, staticAlias, providerId }) {
  if (modelId.startsWith(`${outputAlias}/`)) return modelId.slice(outputAlias.length + 1);
  if (modelId.startsWith(`${staticAlias}/`)) return modelId.slice(staticAlias.length + 1);
  if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
  return modelId;
}

// Nested combo names are valid seats — the model selector exposes them and
// chat routing resolves them recursively — but a no-slash seat is otherwise
// treated as a literal model and publishes the 200k floor. Expand nested
// names (cycle-guarded) so the published window is the true min across the
// whole chain.
function comboSeatLimits(combo, combosByName, visiting = new Set()) {
  const name = typeof combo?.name === "string" ? combo.name : null;
  if (name) {
    if (visiting.has(name)) return { contextWindow: undefined, maxOutput: undefined };
    visiting.add(name);
  }

  let contextWindow = Infinity;
  let maxOutput = Infinity;
  try {
    for (const seat of Array.isArray(combo?.models) ? combo.models : []) {
      if (typeof seat !== "string") continue;
      const slash = seat.indexOf("/");
      if (slash <= 0) {
        const nested = combosByName.get(seat);
        if (nested) {
          const nestedLimits = comboSeatLimits(nested, combosByName, visiting);
          if (Number.isFinite(nestedLimits.contextWindow)) contextWindow = Math.min(contextWindow, nestedLimits.contextWindow);
          if (Number.isFinite(nestedLimits.maxOutput)) maxOutput = Math.min(maxOutput, nestedLimits.maxOutput);
          continue;
        }
      }
      const caps = comboSeatCapabilities(seat) || getCapabilitiesForModel(null, seat);
      if (Number.isFinite(caps?.contextWindow)) contextWindow = Math.min(contextWindow, caps.contextWindow);
      if (Number.isFinite(caps?.maxOutput)) maxOutput = Math.min(maxOutput, caps.maxOutput);
    }
  } finally {
    if (name) visiting.delete(name);
  }

  return {
    contextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
    maxOutput: Number.isFinite(maxOutput) ? maxOutput : undefined,
  };

}

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter, options = {}) {
  // Cycle detection. `skipDynamicFetch` is the explicit override; the two
  // headers are the shapes a peer's internal fetch arrives in:
  //  - `legacyInternalFetch`: an instance that predates the origin header still
  //    sends only the internal marker and still expects a static answer. Honour
  //    it, or a partially-upgraded federation stops terminating.
  //  - the origin coming back unchanged: the chain returned to the process that
  //    started it, so this hop must not fan out again.
  // Both are resolved here rather than in the GET handler so the per-kind and
  // exact-model routes inherit the same guard for free.
  const ownOrigin = modelsFetchOriginId();
  const skipDynamicFetch = options.skipDynamicFetch === true
    || options.legacyInternalFetch === true
    || options.originId === ownOrigin;
  const connections = [];
  // Distinguishes a SUCCESSFUL lookup that found nothing (fresh install: only
  // credentialless providers are usable) from a FAILED lookup (DB unavailable:
  // keep the all-static fail-open list so discovery is not erased).
  let connectionsLoaded = false;
  try {
    const fetched = await getProviderConnections();
    connections.push(...fetched);
    connectionsLoaded = true;
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }
  const activeConnections = connections.filter(c => c.isActive !== false);

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

  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of activeConnections) {
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
  const combosByName = new Map(
    combos.filter((c) => typeof c?.name === "string").map((c) => [c.name, c]),
  );

  // Lookup map so aggregateComboCapabilities can recursively resolve nested combos
  const comboByName = Object.fromEntries(combos.map((c) => [c.name, c.models]));

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    } else {
      const comboCaps = aggregateComboCapabilities(combo.models, comboByName, comboSeatCapabilities);
      if (comboCaps) entry.capabilities = comboCaps;
      // Any seat can serve the request, so the only window a combo can promise is
      // its smallest. Combo entries were the only models on this endpoint that
      // published no limits at all, which leaves a client to guess from the name —
      // and it guesses high (see the snake_case note on the per-provider path).
      const { contextWindow, maxOutput } = comboSeatLimits(combo, combosByName);
      if (Number.isFinite(contextWindow)) entry.context_length = contextWindow;
      if (Number.isFinite(maxOutput)) entry.max_completion_tokens = maxOutput;
    }
    models.push(entry);
  }

  if (activeConnections.length === 0) {
    // Two very different states land here:
    //  - the lookup SUCCEEDED and found nothing (fresh install) -> advertise
    //    only providers that genuinely need no credentials (and whose
    //    credentialless path is usable from this process — see
    //    providerIsUsableWithoutCredentials). Listing the whole static catalog
    //    here is what advertised ~1000 models that immediately fail chat with
    //    404 "No active credentials for provider".
    //  - the lookup FAILED (DB unavailable) -> keep the legacy all-static
    //    fail-open catalog so a transient error cannot erase discovery.
    const failOpen = !connectionsLoaded;
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = ALIAS_TO_PROVIDER_ID[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      // Credential-required AND vendor-client-only providers are both unusable
      // from this process until a connection exists.
      if (!failOpen && !providerIsUsableWithoutCredentials(providerId)) continue;
      for (const model of providerModels) {
        if (!kindFilter.includes(modelKind(model))) continue;
        if (isDisabled(alias, model.id) || isDisabled(providerId, model.id)) continue;
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          owned_by: alias,
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
      // A custom model on a credential-required (or vendor-client-only)
      // provider is just as unusable as its provider's static models until a
      // connection exists.
      if (!failOpen && !providerIsUsableWithoutCredentials(aliasToProviderId[providerAlias] || providerAlias)) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        owned_by: providerAlias,
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

      // Node identity, resolved before the model list so the same three names are
      // used for the lookup, the prefix handling and the published ids.
      const nodeAliases = { outputAlias, staticAlias, providerId };

      // Build kind lookup for static models so we can filter even when only IDs are exposed
      const staticModelKindById = new Map(
        providerModels.map((m) => [m.id, modelKind(m)])
      );
      let liveModelKindById = new Map();
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

      // A compatible node is a passthrough: it offers whatever its upstream
      // offers. Resolve that from the upstream unless the user pinned an
      // explicit enabledModels list (an opt-in override; no fan-out then).
      //
      // The lookup is attempted ALWAYS for a compatible node, not only when the
      // static list is empty. The old gate (`rawModelIds.length === 0`) meant a
      // node whose prefix names anything at all with a static list — and, more
      // importantly, any node on an upstream the guard suppressed — short-
      // circuited before the fetch: the upstream was never read and the listing
      // was whatever the local catalog happened to hold. The static list is
      // still the fallback when the lookup cannot answer at all.
      let passthroughIds = null;
      let usedStaticFallback = false;
      if (isCompatibleProvider && !hasExplicitEnabledModels && !skipDynamicFetch) {
        usedStaticFallback = true;
        const discovered = await fetchCompatibleModelIds(conn, { originId: options.originId });
        if (discovered && discovered.length > 0) {
          // Keep the node's own non-passthrough entries: ids the upstream echoes
          // back already carrying this node's prefix still name a node model.
          passthroughIds = Array.from(
            new Set([...discovered, ...nodeOwnedUpstreamIds(rawModelIds, nodeAliases)]),
          );
          usedStaticFallback = false;
        } else if (discovered && discovered.length === 0) {
          // Reachable, but it offered nothing for this node: an upstream that
          // answers with an empty list is an answer.
          passthroughIds = [];
          usedStaticFallback = false;
        }
        // discovered === null (no credential / no base URL) leaves rawModelIds
        // exactly as before — the configured list stays the catalog.
      }
      if (passthroughIds !== null) {
        rawModelIds = passthroughIds;
      }
      if (isCompatibleProvider && usedStaticFallback) {
        console.log(
          `Compatible model listing unavailable for ${providerId}; listing the configured models`,
        );
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
        .map((modelId) => stripNodePrefixes(modelId, nodeAliases))
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      const customModelKindById = new Map();
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
          return modelId;
        })
        .filter((modelId) => modelId !== "");

      const aliasModelIds = Object.values(modelAliases || {})
        .filter((fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
          return (
            fullModel.startsWith(`${outputAlias}/`) ||
            fullModel.startsWith(`${staticAlias}/`) ||
            fullModel.startsWith(`${providerId}/`)
          );
        })
        .map((fullModel) => stripNodePrefixes(fullModel, nodeAliases))
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      // One entry per model id under the node's prefix. The prefix is stripped
      // once here and added once below, so an id that arrives already carrying
      // the node's prefix can never be published as `${prefix}/${prefix}/${id}`.
      const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
      const seenPublishedIds = new Set();

      for (const modelId of mergedModelIds) {
        // Resolve kind: prefer custom/live metadata, then static, then ID heuristics.
        const customKind = customModelKindById.get(modelId);
        const liveKind = liveModelKindById.get(modelId);
        const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        // imageToText custom models stay in the LLM list (vision-capable chat models)
        const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
        if (!kindFilter.includes(kind) && !allowAsLlm) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId) || isDisabled(providerId, modelId)) continue;
        if (seenPublishedIds.has(modelId)) continue;
        seenPublishedIds.add(modelId);

        const model = {
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
        };
        // Live-catalog resolvers (kiro/qoder/github/clinepass) mostly only return
        // { id, name } — no per-model capability data. Fall back to the same
        // pattern-matched capabilities the dashboard uses (useModelCaps.js) so
        // dynamically-discovered LLM models still surface vision/reasoning/search/tools.
        const liveCaps = liveCapabilitiesById.get(modelId);
        const serviceCaps = capabilitiesFromServiceKind(customKind || liveKind);
        const caps = liveCaps || serviceCaps || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
        if (caps) model.capabilities = caps;
        // Token limits under the snake_case names the OpenAI/OpenRouter
        // convention uses. `capabilities.contextWindow` is camelCase and nested,
        // so clients matching context_length find nothing, fall back to guessing
        // the window from the model name, and guess high — a 372k model read as
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

      // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
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

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }

  return dedupedModels;
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

/** Shared by the list route and the per-kind / exact-model route. */
export async function buildModelsListForRequest(request, kindFilter) {
  // A chain that comes back to THIS process has recursed: stop fanning out and
  // answer from the static view. The identity travels in a header we mint for
  // the chain's first hop and forward unchanged afterwards.
  const incomingOrigin = request?.headers?.get(MODELS_FETCH_ORIGIN_HEADER);
  // A peer using the legacy marker (an instance that predates the origin header)
  // sends no origin and expects the old suppression. The origin header supersedes
  // it: a new-style caller must not be answered from the static view, because
  // that is what reduced a 96-model upstream to a single id.
  const legacyInternalFetch = !incomingOrigin
    && request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
  return buildModelsList(kindFilter, { legacyInternalFetch, originId: incomingOrigin });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request) {
  try {
    // Federation recursion guard: origin header supersedes the legacy internal
    // marker (buildModelsListForRequest resolves both + chain-return detection).
    // Per-key access filtering (upstream) is applied on top — a key restricted
    // to selected combos/models must not see the full list.
    const data = await filterModelsListForKey(
      await getKeyAccessContext(request),
      await buildModelsListForRequest(request, [LLM_KIND])
    );
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
