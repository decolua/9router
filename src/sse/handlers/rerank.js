import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleRerankCore } from "open-sse/handlers/rerankCore.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials, toCoreResult } from "./typeHelpers.js";

/**
 * Handle rerank request — Cohere/Jina/Voyage-style /v1/rerank passthrough.
 * Follows the same auth + fallback pattern as handleChat/handleEmbeddings.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleRerank(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  log.request("POST", `${url.pathname} | ${modelStr}`);

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey, request);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (body.query === undefined || body.query === null) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  if (!Array.isArray(body.documents)) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: documents (array)");

  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    (m) => handleSingleModelRerank(m, body),
    log
  );
}

async function handleSingleModelRerank(modelStr, body) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("RERANK", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const { getExecutor } = await import("open-sse/executors/index.js");
  const executor = getExecutor(provider);
  if (executor?.noAuth) {
    const result = toCoreResult(
      await handleRerankCore({ body, modelInfo: { provider, model }, credentials: {}, log }),
      "Rerank failed",
    );
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Rerank failed");
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("RERANK", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const result = toCoreResult(
      await handleRerankCore({
        body,
        modelInfo: { provider, model },
        credentials: toExecutorCredentials({ ...credentials }),
        log,
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
        },
      }),
      "Rerank failed",
    );

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response;
  }
}
