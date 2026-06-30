import { getProviderCredentials, extractApiKey, isValidApiKey } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleCountTokensCore, estimateTokens } from "open-sse/handlers/countTokensCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

/**
 * Handle /v1/messages/count_tokens. Calls the provider's native count_tokens
 * endpoint when Claude-compatible; otherwise returns the heuristic estimate.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleCountTokens(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey || !(await isValidApiKey(apiKey, request))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  const modelStr = body.model;
  // No model (or unresolvable) → estimate directly from the body.
  if (!modelStr) {
    return Response.json({ input_tokens: estimateTokens(body), approximate: true });
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo?.provider) {
    return Response.json({ input_tokens: estimateTokens(body), approximate: true });
  }

  const { provider, model } = modelInfo;
  // count_tokens is best-effort: a single credential attempt is enough (the core
  // falls back to the estimate on any failure / no native endpoint).
  const credentials = (await getProviderCredentials(provider, new Set(), model)) || {};
  const result = await handleCountTokensCore({ body, modelInfo: { provider, model }, credentials, log });
  return result.response;
}
