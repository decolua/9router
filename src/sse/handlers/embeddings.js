import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";

/**
 * Handle embeddings request for the SSE/Next.js server.
 * Follows the same auth + fallback pattern as handleChat.
 *
 * @param {Request} request
 */
export async function handleEmbeddings(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  // Log API key (masked)
  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Credential + fallback loop (mirrors handleChat)
  let excludeConnectionId = null;
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionId, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (!excludeConnectionId) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const accountId = credentials.connectionId.slice(0, 8);
    log.info("AUTH", `Using ${provider} account: ${accountId}...`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${accountId}... unavailable (${result.status}), trying fallback`);
      excludeConnectionId = credentials.connectionId;
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
