import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Derive a provider's /rerank endpoint. Rerank-capable providers are either chat
// providers (transport.baseUrl ending in /chat/completions) or embedding-only
// providers (embeddingConfig.baseUrl ending in /embeddings). Returns null when no
// rerank endpoint can be derived.
export function deriveRerankUrl(cfg) {
  const chat = cfg?.transport?.baseUrl;
  if (chat && /\/chat\/completions$/.test(chat)) return chat.replace(/\/chat\/completions$/, "/rerank");
  const emb = cfg?.embeddingConfig?.baseUrl;
  if (emb && /\/embeddings$/.test(emb)) return emb.replace(/\/embeddings$/, "/rerank");
  return null;
}

/**
 * Core rerank handler — generic passthrough for Cohere/Jina/Voyage-style /rerank.
 * Forwards { model, query, documents, top_n, ... } verbatim; the provider's native
 * response shape is returned unchanged.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleRerankCore({ body, modelInfo, credentials, log, onRequestSuccess }) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDERS[provider];
  const url = deriveRerankUrl(cfg);
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
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "Rerank request failed");
  }

  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, executor);
    return createErrorResult(errInfo.status || res.status, errInfo.message || `Upstream error from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const text = await res.text();
  return {
    success: true,
    response: new Response(text, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
