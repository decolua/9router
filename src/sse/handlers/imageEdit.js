import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleImageEditCore } from "open-sse/handlers/imageEditCore.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials, toCoreResult } from "./typeHelpers.js";

// Allow large image uploads (mask + image can be several MB).
export const maxDuration = 300;

/**
 * Handle image-edit request — OpenAI /v1/images/edits multipart passthrough.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleImageEdit(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const modelField = formData.get("model");
  const modelStr = typeof modelField === "string" ? modelField : null;
  const url = new URL(request.url);
  log.request("POST", `${url.pathname} | ${modelStr}`);

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey, request);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("image")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");
  if (!formData.get("prompt")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    (m) => handleSingleModelImageEdit(m, formData),
    log
  );
}

async function handleSingleModelImageEdit(modelStr, formData) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

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

    const result = toCoreResult(
      await handleImageEditCore({
        formData,
        modelInfo: { provider, model },
        credentials: toExecutorCredentials({ ...credentials }),
        log,
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
        },
      }),
      "Image edit failed",
    );

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image edit failed");
  }
}
