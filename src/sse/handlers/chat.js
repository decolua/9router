import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { getModelSpeedStats } from "@/lib/requestDetailsDb.js";

/**
 * Sort models by speed (tokens/s) from last successful request
 * @param {string[]} models - Array of model strings
 * @param {object} log - Logger instance
 * @returns {Promise<string[]>} Sorted models (fastest first)
 */
async function sortModelsBySpeed(models, log) {
  try {
    // Resolve each model to provider/model
    const modelInfos = await Promise.all(
      models.map(async (modelStr, originalIndex) => {
        const info = await getModelInfo(modelStr);
        return { modelStr, provider: info.provider, model: info.model, originalIndex };
      })
    );

    // Filter out combos (provider is null) and get speed stats for actual models
    const actualModels = modelInfos.filter(m => m.provider !== null);
    const speedStats = await getModelSpeedStats(
      actualModels.map(m => ({ provider: m.provider, model: m.model }))
    );

    // Separate models with and without speed data
    const withSpeed = [];
    const withoutSpeed = [];

    modelInfos.forEach(m => {
      const key = m.provider ? `${m.provider}/${m.model}` : null;
      if (key && speedStats.has(key) && speedStats.get(key).speed > 0) {
        withSpeed.push({ ...m, speed: speedStats.get(key).speed });
      } else {
        withoutSpeed.push(m);
      }
    });

    // Sort models with speed data by speed (descending)
    withSpeed.sort((a, b) => b.speed - a.speed);

    // Keep models without speed data in their original order
    withoutSpeed.sort((a, b) => a.originalIndex - b.originalIndex);

    // Combine: models WITHOUT speed data FIRST (exploration), then speed-sorted (exploitation)
    const sorted = [...withoutSpeed, ...withSpeed];
    const sortedModels = sorted.map(m => m.modelStr);

    // Log the sorted order with speeds
    log.info("SPEED", `Sorted by tokens/s (untested models prioritized for benchmarking):`);
    sorted.forEach((m, i) => {
      const speed = m.speed ? m.speed.toFixed(1) : "N/A";
      log.info("SPEED", `  ${i + 1}. ${m.modelStr} (${speed} tok/s)`);
    });

    return sortedModels;
  } catch (error) {
    log.warn("SPEED", `Failed to sort by speed: ${error.message}, using custom order`);
    return models;
  }
}

/**
 * Sort models by weight using weighted random sampling (A-Res)
 * Higher weights have a higher probability of being sorted first.
 * @param {string[]} models - Array of model strings
 * @param {object} weights - Map of model string to weight (e.g. { "glm-x": 80, "ag/gemini-3.1-pro-low": 20 })
 * @param {object} log - Logger instance
 * @returns {string[]} Sorted models
 */
function sortModelsByWeight(models, weights, log) {
  try {
    // If no weights or empty models, return as is
    if (!models || models.length === 0) return models;

    // Use A-Res algorithm (weighted random sampling without replacement)
    // score = random() ^ (1 / weight) - highest score wins
    const scored = models.map(model => {
      // Default weight is 10 if not specified
      const weight = Math.max(0.1, Number(weights?.[model]) || 10);
      const score = Math.pow(Math.random(), 1 / weight);
      return { model, score, weight };
    });

    scored.sort((a, b) => b.score - a.score);

    // Log the selected order
    log.info("WEIGHT", `Randomly selected by weight:`);
    scored.forEach((m, i) => {
      log.info("WEIGHT", `  ${i + 1}. ${m.model} (weight: ${m.weight})`);
    });

    return scored.map(m => m.model);
  } catch (error) {
    log.warn("WEIGHT", `Failed to sort by weight: ${error.message}, using custom order`);
    return models;
  }
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 * @param {Request} request
 * @param {object|null} clientRawRequest
 * @param {string|null} forceSourceFormat - Override auto-detected source format (e.g. "claude" for /v1/messages)
 */
export async function handleChat(request, clientRawRequest = null, forceSourceFormat = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
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
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboData = await getComboModels(modelStr);
  if (comboData) {
    let models = comboData.models;
    const priorityMode = comboData.priorityMode || "custom";
    const weights = comboData.weights || {};

    // Sort models based on priority mode
    if (priorityMode === "speed") {
      models = await sortModelsBySpeed(models, log);
    } else if (priorityMode === "weight") {
      models = sortModelsByWeight(models, weights, log);
    }

    log.info("CHAT", `Combo "${modelStr}" with ${models.length} models (${priorityMode} priority)`);
    return handleComboChat({
      body,
      models,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, forceSourceFormat),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, forceSourceFormat);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, forceSourceFormat = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboData = await getComboModels(modelStr);
    if (comboData) {
      let models = comboData.models;
      const priorityMode = comboData.priorityMode || "custom";
      const weights = comboData.weights || {};

      // Sort models based on priority mode
      if (priorityMode === "speed") {
        models = await sortModelsBySpeed(models, log);
      } else if (priorityMode === "weight") {
        models = sortModelsByWeight(models, weights, log);
      }

      log.info("CHAT", `Combo "${modelStr}" with ${models.length} models (${priorityMode} priority)`);
      return handleComboChat({
        body,
        models,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, forceSourceFormat),
        log
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
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
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (!excludeConnectionId) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    const accountId = credentials.connectionId.slice(0, 8);
    log.info("AUTH", `Using ${provider} account: ${accountId}...`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      // Detect source format by endpoint + body, or override explicitly
      sourceFormatOverride: forceSourceFormat || (request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null),
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

    // Mark account unavailable (auto-calculates cooldown with exponential backoff)
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
