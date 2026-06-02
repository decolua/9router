import { extractUnsupportedParamFromText } from "../../open-sse/utils/unsupportedParam.js";

// Validation probes need enough output budget to avoid false 400s from models
// that reject too-small caps as "max_tokens or model output limit was reached".
// Keep this bounded, but do not lower to 1 without rechecking OpenAI/gpt-5.x.
export const OPENAI_STYLE_PROBE_MAX_TOKENS = 64;

async function getTokenFallbackPayload(response, payload) {
  if (response.status !== 400 || !payload || typeof payload !== "object") {
    return null;
  }

  const responseText = await response.clone().text().catch(() => "");
  const unsupported = extractUnsupportedParamFromText(responseText);
  if (!unsupported) return null;

  const { param, msg } = unsupported;
  const hasMaxTokens = payload.max_tokens !== undefined;
  const hasMaxCompletionTokens = payload.max_completion_tokens !== undefined;

  if (hasMaxTokens && !hasMaxCompletionTokens && (param === "max_tokens" || msg.includes("max_completion_tokens"))) {
    const nextPayload = { ...payload, max_completion_tokens: payload.max_tokens };
    delete nextPayload.max_tokens;
    return nextPayload;
  }

  if (hasMaxCompletionTokens && !hasMaxTokens && (param === "max_completion_tokens" || msg.includes("max_tokens"))) {
    const nextPayload = { ...payload, max_tokens: payload.max_completion_tokens };
    delete nextPayload.max_completion_tokens;
    return nextPayload;
  }

  return null;
}

async function discardResponseBody(response) {
  if (!response?.body) return;

  if (typeof response.body.cancel === "function") {
    await response.body.cancel().catch(() => {});
    return;
  }

  if (!response.bodyUsed && typeof response.arrayBuffer === "function") {
    await response.arrayBuffer().catch(() => {});
  }
}

export async function fetchOpenAIStyleWithTokenFallback(fetcher, url, options = {}, payload) {
  const buildOptions = (body) => ({
    ...options,
    body: JSON.stringify(body)
  });

  const firstResponse = await fetcher(url, buildOptions(payload));
  const fallbackPayload = await getTokenFallbackPayload(firstResponse, payload);
  if (!fallbackPayload) return firstResponse;

  await discardResponseBody(firstResponse);
  return fetcher(url, buildOptions(fallbackPayload));
}
