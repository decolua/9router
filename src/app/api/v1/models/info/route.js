import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { getCustomModels, getProviderConnections } from "@/lib/localDb";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { applyModelLimitsToCaps, modelLimitsForOpenAI, withoutModelLimits } from "@/shared/utils/modelTokenLimits";

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

function buildInfo({ alias, providerId, model, kind, providerInfo, caps }) {
  const out = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
  };
  if (model.params) out.params = model.params;
  if (caps || model.capabilities) out.capabilities = caps || model.capabilities;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (caps?.contextWindow || model.contextWindow) out.contextWindow = caps?.contextWindow || model.contextWindow;
  if (kind === "tts" && TTS_VOICES_API.has(providerId)) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig;
    if (cfg.searchTypes) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions) out.required = cfg.requiredOptions;
  }
  return kind === "llm" ? { ...out, ...modelLimitsForOpenAI({ caps: caps || model }) } : out;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
async function lookup(fullId, requestedKind) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  let providerId = ALIAS_TO_ID[alias] || alias;
  let storageAliases = new Set([alias, providerId]);
  try {
    const matchingConnection = (await getProviderConnections()).find((connection) =>
      connection?.providerSpecificData?.prefix === alias || connection?.provider === alias
    );
    if (matchingConnection?.provider) {
      providerId = matchingConnection.provider;
      storageAliases = new Set([alias, providerId]);
    }
  } catch {
    // Static model info remains available when connections cannot be read.
  }
  const providerInfo = AI_PROVIDERS[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = requestedKind
    ? list.find((x) => x.id === modelId && getModelKind(x, "llm") === requestedKind)
    : list.find((x) => x.id === modelId);

  let customModel = null;
  try {
    const customModels = await getCustomModels();
    customModel = customModels.find((item) =>
      item?.id === modelId
      && storageAliases.has(item.providerAlias)
      && (!requestedKind || getModelKind(item, "llm") === requestedKind)
    ) || null;
  } catch {
    // Keep static lookup available when persistence is temporarily unavailable.
  }

  if (customModel) {
    const kind = getModelKind(customModel, "llm");
    const fallback = getCapabilitiesForModel(providerId, modelId);
    const caps = applyModelLimitsToCaps({
      ...(m ? fallback : withoutModelLimits(fallback)),
      ...(customModel.caps || {}),
    }, customModel);
    return buildInfo({ alias, providerId, model: customModel, kind, providerInfo, caps });
  }
  if (m) {
    const kind = getModelKind(m, "llm");
    return buildInfo({
      alias,
      providerId,
      model: m,
      kind,
      providerInfo,
      caps: kind === "llm" ? getCapabilitiesForModel(providerId, modelId) : null,
    });
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
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/dall-e-3)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const info = await lookup(id, kind);
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
