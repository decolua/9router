import { buildModelsList } from "../route.js";
import { extractApiKey } from "@/sse/services/auth.js";
import { getApiKeyScopeByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { filterModelsByScope } from "@/lib/scopeModelsFilter.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

const LLM_KIND = "llm";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function json(data, options = {}) {
  return Response.json(data, {
    ...options,
    headers: {
      "Access-Control-Allow-Origin": "*",
      ...options.headers,
    },
  });
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * GET /v1/models/{provider}/{model} - OpenAI-compatible single model lookup.
 * Supported kinds: image, tts, stt, embedding, image-to-text, web.
 */
export async function GET(request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;

    const apiKey = extractApiKey(request);
    const scope = apiKey ? await getApiKeyScopeByKey(apiKey) : null;

    if (kindFilter) {
      const data = await buildModelsList(kindFilter);
      return json({ object: "list", data: filterModelsByScope(data, scope) });
    }

    // Match the same LLM catalog exposed by GET /v1/models. A catch-all
    // parameter is required because provider-prefixed IDs contain a slash.
    const models = filterModelsByScope(await buildModelsList([LLM_KIND]), scope);
    const matchedModel = models.find((candidate) => candidate.id === identifier);

    if (!matchedModel) {
      return json(
        {
          error: {
            message: `The model '${identifier}' does not exist or you do not have access to it.`,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        { status: 404 },
      );
    }

    return json(matchedModel);
  } catch (error) {
    console.log("Error fetching model:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}
