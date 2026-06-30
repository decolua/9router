import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Derive a provider's /rerank endpoint from two sources:
//   - chat providers: PROVIDERS[id].baseUrl ending in /chat/completions
//   - embedding-only providers: PROVIDER_MEDIA[id].embeddingConfig.baseUrl ending in /embeddings
//     (these have transport:null, so they are absent from PROVIDERS)
// Returns null when no rerank endpoint can be derived.
export function deriveRerankUrl(transportCfg, mediaCfg) {
  const tc = isRecord(transportCfg) ? transportCfg : undefined;
  const chat = typeof tc?.baseUrl === "string" ? tc.baseUrl : undefined;
  if (chat && /\/chat\/completions$/.test(chat)) return chat.replace(/\/chat\/completions$/, "/rerank");

  const mc = isRecord(mediaCfg) ? mediaCfg : undefined;
  const embeddingConfig = mc?.embeddingConfig;
  const embCfg = isRecord(embeddingConfig) ? embeddingConfig : undefined;
  const emb = typeof embCfg?.baseUrl === "string" ? embCfg.baseUrl : undefined;
  if (emb && /\/embeddings$/.test(emb)) return emb.replace(/\/embeddings$/, "/rerank");

  return null;
}

/**
 * Core rerank handler — generic passthrough for Cohere/Jina/Voyage-style /rerank.
 * Forwards { model, query, documents, top_n, ... } verbatim; the provider's native
 * response shape is returned unchanged.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, query, documents, top_n, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleRerankCore({
  body,
  modelInfo,
  credentials = null,
  log = null,
  onRequestSuccess = null,
}) {
  const { provider, model } = modelInfo;
  const url = deriveRerankUrl(PROVIDERS[provider], PROVIDER_MEDIA[provider]);
  if (!url) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not expose a derivable /rerank endpoint`);
  }

  const executor = getExecutor(provider);
  const headers = executor.buildHeaders(credentials || {}, false);

  log?.debug?.("RERANK", `${provider} | ${model} | ${url}`);

  let res;
  try {
    res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model }),
    });
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Rerank request failed");
  }

  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, executor);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const text = await res.text();
  return {
    success: true,
    status: res.status,
    response: new Response(text, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
