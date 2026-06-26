import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getCachedUpstreamCapabilities, fetchAndCacheUpstreamModels } from "@/lib/upstreamModelMetadata";
import { getProviderConnections } from "@/lib/localDb";

const KIND_ENDPOINT = {
  llm: "/v1/chat/completions",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions",
  webSearch: "/v1/search",
  webFetch: "/v1/fetch",
};

const TTS_VOICES_API = new Set(["elevenlabs", "edge-tts", "deepgram", "inworld", "local-device"]);

function buildInfo({ alias, providerId, model, kind, providerInfo }) {
  const out = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
  };
  if (model.params) out.params = model.params;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (model.upstreamModelId) out.upstreamModelId = model.upstreamModelId;

  // Resolve capabilities from the central capability system (pattern-matched,
  // falls back through provider-specific → exact → pattern → default).
  const caps = getCapabilitiesForModel(providerId, model.upstreamModelId || model.id);
  out.capabilities = caps;
  if (caps.contextWindow) out.contextWindow = caps.contextWindow;
  if (kind === "tts" && TTS_VOICES_API.has(providerId)) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig;
    if (cfg.searchTypes) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions) out.required = cfg.requiredOptions;
  }
  return out;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
function lookup(fullId, requestedKind) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = requestedKind
    ? list.find((x) => x.id === modelId && getModelKind(x, "llm") === requestedKind)
    : list.find((x) => x.id === modelId);
  if (m) {
    const kind = getModelKind(m, "llm");
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }

  // Web search/fetch — virtual model id "search" / "fetch"
  if (modelId === "search" && providerInfo?.searchConfig) {
    return buildInfo({
      alias, providerId, kind: "webSearch", providerInfo,
      model: { id: "search", name: `${providerInfo.name} Search`, params: ["query", "max_results", "country", "language", "time_range", "domain_filter", "search_type"] },
    });
  }
  if (modelId === "fetch" && providerInfo?.fetchConfig) {
    return buildInfo({
      alias, providerId, kind: "webFetch", providerInfo,
      model: { id: "fetch", name: `${providerInfo.name} Fetch`, params: ["url", "format", "max_characters"] },
    });
  }

  // Model not in static registry — build a synthetic entry so capabilities
  // can still be resolved via getCapabilitiesForModel + upstream metadata.
  // This handles custom provider models (fetched live) and unknown models.
  return buildInfo({
    alias, providerId,
    model: { id: modelId },
    kind: requestedKind || "llm",
    providerInfo,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/models/info?id={alias}/{modelId} — metadata for a single model
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/dall-e-3)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const info = lookup(id, kind);
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // Try to enrich with upstream provider metadata (best-effort, never fails the request).
  try {
    const slash = id.indexOf("/");
    const alias = id.slice(0, slash);
    const providerId = ALIAS_TO_ID[alias] || alias;
    const modelId = info.upstreamModelId || id.slice(slash + 1);

    // 1. Check cache (sync, cheap)
    let upstreamCaps = getCachedUpstreamCapabilities(providerId, modelId);

    // 2. Cache miss — try live fetch from upstream
    if (!upstreamCaps) {
      let connections = [];
      try { connections = await getProviderConnections(); } catch { /* DB unavailable */ }

      // Match connection by provider ID, or by alias/prefix (custom providers
      // use UUID-prefixed IDs like "openai-compatible-chat-<uuid>" while the URL
      // uses the human-readable alias/prefix like "syn").
      const connection = connections.find(
        (c) => c.isActive !== false && (c.apiKey || c.accessToken) && (
          c.provider === providerId ||
          c.provider === alias ||
          c.prefix === alias ||
          c.providerSpecificData?.prefix === alias
        ),
      );
      if (connection) {
        try {
          const modelMap = await fetchAndCacheUpstreamModels(connection);
          if (modelMap) upstreamCaps = modelMap.get(modelId) || null;
        } catch { /* fetch failed, fall through */ }
      }
    }

    // 3. Merge upstream values over static capabilities
    if (upstreamCaps) {
      if (upstreamCaps.contextWindow != null) {
        info.capabilities.contextWindow = upstreamCaps.contextWindow;
        info.contextWindow = upstreamCaps.contextWindow;
      }
      if (upstreamCaps.maxOutput != null) {
        info.capabilities.maxOutput = upstreamCaps.maxOutput;
      }
      if (upstreamCaps.vision != null) {
        info.capabilities.vision = upstreamCaps.vision;
      }
      if (upstreamCaps.reasoning != null) {
        info.capabilities.reasoning = upstreamCaps.reasoning;
      }
      if (upstreamCaps.search != null) {
        info.capabilities.search = upstreamCaps.search;
      }
    }
  } catch { /* best-effort enrichment — never fail the request */ }

  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
