import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleTtsCore } from "open-sse/handlers/ttsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

// Providers that require stored credentials (not noAuth)
const CREDENTIALED_PROVIDERS = new Set(["openai", "elevenlabs"]);

export async function handleTts(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  const responseFormat = url.searchParams.get("response_format") || "mp3"; // mp3 (default) | json
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}`);

  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);

  // noAuth providers — no credential needed
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleTtsCore({ provider, model, input: body.input, responseFormat });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed");
  }

  // Credentialed providers — fallback loop (same pattern as embeddings)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const result = await handleTtsCore({ provider, model, input: body.input, credentials, responseFormat });

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
