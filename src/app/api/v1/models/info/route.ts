import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";

const KIND_ENDPOINT: Record<string, string> = {
  llm: "/v1/chat/completions",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions",
  webSearch: "/v1/search",
  webFetch: "/v1/fetch",
};

const TTS_VOICES_API: Record<string, true> = {
  elevenlabs: true,
  "edge-tts": true,
  deepgram: true,
  inworld: true,
  "local-device": true,
};

interface ModelEntry {
  id: string;
  name?: string;
  params?: JsonValue;
  capabilities?: JsonValue;
  options?: JsonValue;
  dimensions?: JsonValue;
  contextWindow?: JsonValue;
}

interface ProviderInfo {
  name?: string;
  alias?: string;
  searchConfig?: {
    searchTypes?: JsonValue;
    maxMaxResults?: JsonValue;
    requiredOptions?: JsonValue;
  };
  fetchConfig?: JsonValue;
}

interface InfoOut {
  id: string;
  name: string;
  kind: string;
  owned_by: string;
  endpoint: string | null;
  params?: JsonValue;
  capabilities?: JsonValue;
  options?: JsonValue;
  dimensions?: JsonValue;
  contextWindow?: JsonValue;
  voicesUrl?: string;
  searchTypes?: JsonValue;
  maxResults?: JsonValue;
  required?: JsonValue;
}

function buildInfo({
  alias,
  providerId,
  model,
  kind,
  providerInfo,
}: {
  alias: string;
  providerId: string;
  model: ModelEntry;
  kind: string;
  providerInfo: ProviderInfo | undefined;
}): InfoOut {
  const out: InfoOut = {
    id: `${alias}/${model.id}`,
    name: model.name ?? model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] ?? null,
  };
  if (model.params !== undefined) out.params = model.params;
  if (model.capabilities !== undefined) out.capabilities = model.capabilities;
  if (model.options !== undefined) out.options = model.options;
  if (model.dimensions !== undefined) out.dimensions = model.dimensions;
  if (model.contextWindow !== undefined) out.contextWindow = model.contextWindow;
  if (kind === "tts" && TTS_VOICES_API[providerId]) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig;
    if (cfg.searchTypes !== undefined) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults !== undefined) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions !== undefined) out.required = cfg.requiredOptions;
  }
  return out;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds
function lookup(fullId: string, requestedKind: string | null): InfoOut | null {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = (ALIAS_TO_ID as Record<string, string>)[alias] ?? alias;
  const providerInfo = (AI_PROVIDERS as Record<string, ProviderInfo>)[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list: ModelEntry[] =
    (PROVIDER_MODELS as Record<string, ModelEntry[]>)[alias] ??
    (PROVIDER_MODELS as Record<string, ModelEntry[]>)[providerId] ??
    [];
  const m = requestedKind
    ? list.find(
        (x) => x.id === modelId && (getModelKind(x) ?? "llm") === requestedKind,
      )
    : list.find((x) => x.id === modelId);
  if (m) {
    const kind = (getModelKind(m) ?? "llm") as string;
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }

  // Web search/fetch — virtual model id "search" / "fetch"
  if (modelId === "search" && providerInfo?.searchConfig) {
    return buildInfo({
      alias,
      providerId,
      kind: "webSearch",
      providerInfo,
      model: {
        id: "search",
        name: `${providerInfo.name ?? providerId} Search`,
        params: [
          "query",
          "max_results",
          "country",
          "language",
          "time_range",
          "domain_filter",
          "search_type",
        ],
      },
    });
  }
  if (modelId === "fetch" && providerInfo?.fetchConfig) {
    return buildInfo({
      alias,
      providerId,
      kind: "webFetch",
      providerInfo,
      model: {
        id: "fetch",
        name: `${providerInfo.name ?? providerId} Fetch`,
        params: ["url", "format", "max_characters"],
      },
    });
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

// GET /v1/models/info?id={alias}/{modelId} — metadata for a single model
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      {
        error: {
          message:
            "Missing required query param: id (e.g. ?id=openai/dall-e-3)",
          type: "invalid_request_error",
        },
      },
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
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
