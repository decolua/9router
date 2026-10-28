import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings, getComboByName } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { getKeyAccessContext, enforceKeyAccess } from "../services/keyAccess.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

/**
 * Handle System One (Jev) decision requests for the Next.js server.
 * Follows the same auth + account-fallback pattern as handleEmbeddings.
 *
 * @param {Request} request
 */
export async function handleSystemone(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("SYSTEMONE", "Invalid JSON body");
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

  if (typeof modelStr !== "string" || !modelStr) {
    log.warn("SYSTEMONE", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }
  if (body.state === undefined || body.state === null) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: state");
  }
  if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: questions");
  }

  // Per-key access control: the requested target (a combo name or a model),
  // checked before combo expansion so an allowed combo grants its members.
  const keyAccessDenied = await enforceKeyAccess(await getKeyAccessContext(request), modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Combo expansion: a bare name may be a saved combo of several System One providers.
  const combo = modelStr.includes("/") ? null : await getComboByName(modelStr);
  if (combo) {
    if (combo.kind !== "systemone") {
      log.warn("SYSTEMONE", `Combo "${combo.name}" is kind ${combo.kind || "llm"}, not systemone`);
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Combo does not support System One");
    }
    const models = combo.models;
    if (models !== undefined && !Array.isArray(models)) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
    }
    if (!Array.isArray(models) || models.length === 0) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "System One combo has no models");
    }
    if (models.some((m) => typeof m !== "string" || !m.trim())) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
    }

    const comboStrategy = settings.comboStrategies?.[combo.name]?.fallbackStrategy || settings.comboStrategy || "fallback";
    log.info("SYSTEMONE", `Combo "${combo.name}" with ${models.length} providers (strategy: ${comboStrategy})`);
    return handleComboChat({
      body,
      models,
      // handleComboChat reads retryAfter from the JSON body, while a single attempt
      // returns it in the retry-after header only (see unavailableResponse). Lift it
      // into the body so an all-members-cooling-down combo still reports the earliest
      // reset time instead of a bare error.
      handleSingleModel: (comboBody, member) =>
        withBodyRetryAfter(handleSingleSystemone(comboBody, member, { apiKey, endpoint: url.pathname, log, fromCombo: true })),
      log,
      comboName: combo.name,
      comboStrategy: comboStrategy === "round-robin" ? "round-robin" : "fallback",
      comboStickyLimit: settings.comboStickyRoundRobinLimit,
      // Decision payloads are native: no capability detection or chat translation.
      autoSwitch: false,
    });
  }

  return handleSingleSystemone(body, modelStr, { apiKey, endpoint: url.pathname, log });
}

/**
 * handleComboChat learns the retry time by parsing a member response body, but the
 * single attempt path returns it as a `retry-after` header (unavailableResponse).
 * Re-emit the same error body with `retryAfter` inside so shared combo aggregation
 * can pick the earliest reset across members instead of dropping it.
 *
 * @param {Promise<Response>} attempt
 * @returns {Promise<Response>}
 */
async function withBodyRetryAfter(attempt) {
  const response = await attempt;
  const retryAfterSec = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) return response;

  const retryAfter = new Date(Date.now() + retryAfterSec * 1000).toISOString();
  let body = { error: { message: "Unavailable" } };
  try {
    const original = await response.clone().json();
    if (original && typeof original === "object" && !Array.isArray(original)) body = original;
  } catch {
    // Non-JSON body — keep the synthesized envelope.
  }

  return new Response(JSON.stringify({ ...body, retryAfter }), {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * Run one System One attempt through the credential + account-fallback loop.
 * Shared by the direct request path and every combo member.
 *
 * @param {object} body - Native System One payload (state + questions)
 * @param {string} modelStr - Combo member or requested model ("alias/model")
 * @param {{apiKey: string|null, endpoint: string, log: object, fromCombo?: boolean}} context
 * @returns {Promise<Response>}
 */
async function handleSingleSystemone(body, modelStr, { apiKey, endpoint, log: logger, fromCombo = false }) {
  if (typeof modelStr !== "string" || !modelStr) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    logger.warn("SYSTEMONE", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // A combo member that cannot serve System One is a configuration error we can
  // reject before spending a credential lookup; the direct path stays as
  // upstream (the core reports the same 400 once it has the credentials).
  if (fromCombo && !PROVIDER_MEDIA[provider]?.systemoneConfig) {
    logger.warn("SYSTEMONE", `Provider ${provider} has no System One config`, { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support System One.`);
  }

  if (modelStr !== `${provider}/${model}`) {
    logger.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    logger.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Credential + fallback loop (mirrors handleEmbeddings)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        logger.warn("SYSTEMONE", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        logger.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      logger.warn("SYSTEMONE", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    logger.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log: logger,
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) {
      if (result.usage) {
        saveRequestUsage({
          provider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint,
          tokens: {
            ...result.usage,
            total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
          },
          status: "success",
        }).catch(() => {});
      }
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);

    if (shouldFallback) {
      logger.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
