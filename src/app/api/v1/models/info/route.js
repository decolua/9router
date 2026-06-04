import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";

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
  if (model.capabilities) out.capabilities = model.capabilities;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (model.contextWindow) out.contextWindow = model.contextWindow;
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
function lookup(fullId) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = list.find((x) => x.id === modelId);
  if (m) {
    const kind = m.type || "llm";
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }

  // Sub-configs (TTS/STT/embedding only-in-config)
  const subs = [
    ["tts", providerInfo?.ttsConfig],
    ["stt", providerInfo?.sttConfig],
    ["embedding", providerInfo?.embeddingConfig],
  ];
  for (const [kind, cfg] of subs) {
    const sm = cfg?.models?.find((x) => x.id === modelId);
    if (sm) return buildInfo({ alias, providerId, model: sm, kind, providerInfo });
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
  return null;
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
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/dall-e-3)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const info = lookup(id);
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
