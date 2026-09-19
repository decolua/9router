import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable, clearAccountError,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { recordModalityUsage, estimateTextTokens, canonicalTokens } from "../utils/mediaUsage.js";
import * as log from "../utils/logger.js";

// Providers requiring credentials for STT
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("stt") && !p.noAuth && p.sttConfig?.authType !== "none")
    .map(([id]) => id)
);

// STT hands back TEXT, not chat tokens: take what the provider reports when it
// reports anything, else count the transcript it produced as completion tokens.
function tokensFromTranscription(payload) {
  return canonicalTokens(payload?.usage)
    || (typeof payload?.text === "string" && payload.text.length
      ? { prompt_tokens: 0, completion_tokens: estimateTextTokens(payload.text) }
      : null);
}

export async function handleStt(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const modelStr = formData.get("model");
  log.request("POST", `/v1/audio/transcriptions | ${modelStr}`);

  const endpoint = new URL(request.url).pathname;
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("file")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  // noAuth providers
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleSttCore({ provider, model, formData, sttConfig: AI_PROVIDERS[provider]?.sttConfig });
    if (result.success) {
      recordModalityUsage({ provider, model, endpoint, apiKey, response: result.response, fromPayload: tokensFromTranscription });
      return result.response;
    }
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
  }

  // Credentialed — fallback loop
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

    // Chat/embeddings parity (T1.8 F5): refresh an expiring token before use and
    // clear the account's error state on success. A refresh that itself throws
    // must not break the request — fall back to the stored credentials.
    let refreshedCredentials = credentials;
    try {
      refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    } catch (err) {
      log.warn("TOKEN", `${provider} | token refresh failed: ${err?.message || err}`);
    }

    const result = await handleSttCore({ provider, model, formData, credentials: refreshedCredentials, sttConfig: AI_PROVIDERS[provider]?.sttConfig });

    if (result.success) {
      try {
        await clearAccountError(credentials.connectionId, credentials, model);
      } catch (err) {
        log.warn("AUTH", `clearAccountError failed for ${credentials.connectionId}: ${err?.message || err}`);
      }
      recordModalityUsage({
        provider, model, endpoint, apiKey, connectionId: credentials.connectionId,
        response: result.response, fromPayload: tokensFromTranscription,
      });
      return result.response;
    }

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
