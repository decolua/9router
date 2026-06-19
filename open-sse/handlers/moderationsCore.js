import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Derive a provider's /moderations endpoint from its chat completions baseUrl.
// https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/moderations
// Tolerates an /openai segment (e.g. deepinfra's /v1/openai/chat/completions).
export function deriveModerationsUrl(baseUrl) {
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl.replace(/\/chat\/completions$/, "/moderations");
  // Fallback: drop the last path segment, append /moderations.
  const u = new URL(baseUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  parts.pop();
  return `${u.origin}${parts.length ? "/" + parts.join("/") : ""}/moderations`;
}

/**
 * Core moderations handler — generic OpenAI-compatible passthrough.
 * Resolves the provider's /moderations URL, applies provider auth via the
 * executor's buildHeaders, and forwards { input, model } verbatim.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleModerationsCore({ body, modelInfo, credentials, log, onRequestSuccess }) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDERS[provider];
  const baseUrl = cfg?.transport?.baseUrl;
  if (!baseUrl) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' has no base URL for moderation`);
  }

  const executor = getExecutor(provider);
  const headers = executor.buildHeaders(credentials || {}, false);
  const url = deriveModerationsUrl(baseUrl);

  log?.debug?.("MODERATION", `${provider} | ${model} | ${url}`);

  let res;
  try {
    res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model }),
    });
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "Moderation request failed");
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
