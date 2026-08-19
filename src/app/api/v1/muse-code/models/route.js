import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Muse Code CLI discovers models via GET {base}/muse-code/models and fills the
// /model menu from the response. Schema (reverse-engineered, matches Muse CLI):
//   { object:"list", data:[{ id, object:"model", created, owned_by, metadata: {
//       name, family, release_date, is_hidden, attachment, reasoning, temperature,
//       tool_call, modalities:{input,output}, limit:{context,output}, options, variants,
//       description, cost } }] }
//
// id format: "<alias>/<model>" so breaking out of this provider (e.g. "ocg/kimi-k2.6")
// is possible; Muse passes it back verbatim as the model in /v1/responses.
const CATALOG_TIMESTAMP = Math.floor(Date.now() / 1000);

function buildCatalogEntry({ outputAlias, providerId, model }) {
  const id = `${outputAlias}/${model.id}`;
  const family = outputAlias;
  const reasoning = !!model.supportsReasoning || /muse-spark|claude|gpt|deepseek|glm|kimi|qwen|minimax|mimo/i.test(id);
  const context = model.contextLength || 200000;
  const output = model.maxOutputTokens || 65536;
  return {
    id,
    object: "model",
    created: CATALOG_TIMESTAMP,
    owned_by: providerId,
    metadata: {
      "muse-code": {
        name: model.name || model.id,
        family,
        release_date: "2026-08-14",
        is_hidden: false,
        attachment: ["image", "pdf", "video"].some((cap) => (model.capabilities || []).includes(cap)),
        reasoning,
        temperature: false,
        tool_call: true,
        modalities: {
          input: ["text", ...((model.capabilities || []).includes("image") ? ["image"] : [])],
          output: ["text"],
        },
        limit: { context, output },
        options: {
          reasoningEffort: reasoning ? "high" : undefined,
          forceReasoning: reasoning,
          include: reasoning ? ["reasoning.encrypted_content"] : [],
          temperature: 0.9,
          top_p: 0.9,
        },
        variants: reasoning
          ? Object.fromEntries(
              ["low", "medium", "high", "xhigh"].map((level) => [
                level,
                { reasoningEffort: level },
              ]),
            )
          : undefined,
        description: `${model.name || model.id} via 9Router (${providerId})`,
        cost: {
          input: "0",
          output: "0",
          cached: "0",
          currency: "USD",
        },
      },
    },
  };
}

function buildCatalog() {
  const entries = [];
  const seen = new Set();
  for (const [providerId, models] of Object.entries(PROVIDER_MODELS)) {
    // Skip internal/hidden providers and non-LLM-only model tables (their keys
    // aren't bare ids like chat models but still usable — keep LLM ones only).
    if (!Array.isArray(models)) continue;
    const reg = REGISTRY.find((r) => r.id === providerId);
    const alias = (reg && (reg.alias || reg.uiAlias)) || providerId;
    for (const model of models) {
      if (!model || typeof model.id !== "string") continue;
      if (model.kind && model.kind !== "llm") continue;
      const entry = buildCatalogEntry({ outputAlias: alias, providerId, model });
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries;
}

const CATALOG = buildCatalog();
const CATALOG_PAYLOAD = JSON.stringify({ object: "list", data: CATALOG }, null, 2);

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET() {
  return new Response(CATALOG_PAYLOAD, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}