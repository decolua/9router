import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getExecutor } from "open-sse/executors/index.js";
import { refreshWithRetry } from "open-sse/services/tokenRefresh.js";

/**
 * Handle OCR request (e.g. Mistral OCR).
 * Proxies the request to the provider's /v1/ocr endpoint.
 */
export async function handleOcr(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("OCR", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr || "default"}`);

  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  }

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
    log.warn("OCR", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("OCR", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  // Credential + fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("OCR", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("OCR", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Build upstream request
    const upstreamUrl = `https://api.${provider}.ai/v1/ocr`;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${refreshedCredentials.apiKey || refreshedCredentials.accessToken}`,
    };

    try {
      log.debug("OCR", `Proxying to ${upstreamUrl}`);
      const providerResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (providerResponse.ok) {
        await clearAccountError(credentials.connectionId, credentials, model);
        const data = await providerResponse.json();
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const errorText = await providerResponse.text();
      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId, providerResponse.status, errorText, provider, model
      );

      if (shouldFallback) {
        log.warn("OCR", `Account ${credentials.connectionName} unavailable (${providerResponse.status}), trying fallback`);
        excludeConnectionIds.add(credentials.connectionId);
        lastError = errorText;
        lastStatus = providerResponse.status;
        continue;
      }

      return errorResponse(providerResponse.status, errorText);
    } catch (error) {
      log.error("OCR", `Fetch error: ${error.message}`);
      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId, HTTP_STATUS.BAD_GATEWAY, error.message, provider, model
      );
      if (shouldFallback) {
        excludeConnectionIds.add(credentials.connectionId);
        lastError = error.message;
        lastStatus = HTTP_STATUS.BAD_GATEWAY;
        continue;
      }
      return errorResponse(HTTP_STATUS.BAD_GATEWAY, error.message);
    }
  }
}
