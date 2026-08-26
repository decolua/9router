import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  getApiKeyPolicyError,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { routeFiniteFreebuff } from "./freebuffRouting.js";
import { resolveConnectionProxyConfig, getProxyBucketIdentity } from "@/lib/network/connectionProxy";
import { acquireAccountSlot } from "open-sse/services/accountSemaphore.js";
import { evaluateCircuit, recordCircuitOutcome } from "open-sse/services/circuitBreaker.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export const DASHBOARD_AUTHORIZED_CONTEXT = Symbol("dashboard-authorized-context");

export async function handleChat(request, clientRawRequest = null, requestContext = null) {
  const isDashboardAuthorized = requestContext === DASHBOARD_AUTHORIZED_CONTEXT;
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
  const modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Dashboard authorization is represented only by the server-owned symbol above.
  // It never accepts client API credentials or API-key-specific policy.
  const authHeader = isDashboardAuthorized ? null : request.headers.get("Authorization");
  const apiKey = isDashboardAuthorized ? null : extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey && !isDashboardAuthorized) {
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

  if (apiKey) {
    const policyErr = await getApiKeyPolicyError(apiKey, modelStr);
    if (policyErr) {
      log.warn("AUTH", policyErr.message);
      return errorResponse(policyErr.status, policyErr.message);
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, modelEntry, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { preferredConnectionId: modelEntry?.connectionId });
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        async (b, m, modelEntry) => {
          if (apiKey && adapterAdded.includes(m)) {
            const policyErr = await getApiKeyPolicyError(apiKey, m);
            if (policyErr) return errorResponse(policyErr.status, policyErr.message);
          }
          return handleSingleModelChat(b, m, clientRawRequest, request, apiKey, { preferredConnectionId: modelEntry?.connectionId });
        },
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        async (b, m) => {
          if (apiKey && adapterAdded.includes(m)) {
            const policyErr = await getApiKeyPolicyError(apiKey, m);
            if (policyErr) return errorResponse(policyErr.status, policyErr.message);
          }
          return handleSingleModelChat(b, m, clientRawRequest, request, apiKey);
        },
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, options = {}) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, modelEntry, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, { preferredConnectionId: modelEntry?.connectionId });
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          async (b, m, modelEntry) => {
            if (apiKey && adapterAdded.includes(m)) {
              const policyErr = await getApiKeyPolicyError(apiKey, m);
              if (policyErr) return errorResponse(policyErr.status, policyErr.message);
            }
            return handleSingleModelChat(b, m, clientRawRequest, request, apiKey, { preferredConnectionId: modelEntry?.connectionId });
          },
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  if (provider === "freebuff") {
    const routed = await routeFiniteFreebuff({
      provider,
      model,
      select: (excludedConnectionIds) => getProviderCredentials(provider, excludedConnectionIds, model, { preferredConnectionId: options.preferredConnectionId }),
      resolvePool: (selected, forceProxyPoolId) => getProviderCredentials(provider, new Set(), model, {
        preferredConnectionId: selected.connectionId,
        forceProxyPoolId,
        allowedProxyPoolIds: [
          ...(selected._connection?.providerSpecificData?.proxyPoolIds || []),
          selected._connection?.providerSpecificData?.proxyPoolId,
        ],
      }),
      dispatch: (credentials) => dispatchChatAttempt({ body, provider, model, credentials, log, clientRawRequest, request, apiKey, userAgent }),
      shouldFallback: async (credentials, result) => {
        const fallback = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);
        return fallback.shouldFallback;
      },
    });
    if (routed.response) return routed.response;
    if (routed.terminal.kind === "quota") {
      return unavailableResponse(429, `[${provider}/${model}] ${routed.terminal.message}`, routed.terminal.reset, "quota reset pending");
    }
    return errorResponse(routed.terminal.status, routed.terminal.message);
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      preferredConnectionId: options.preferredConnectionId,
    });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }
    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    const resolvedProxy = await resolveConnectionProxyConfig(refreshedCredentials.providerSpecificData || {}, credentials.connectionId);
    const bucket = getProxyBucketIdentity(resolvedProxy);
    if (!bucket) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = "Unable to resolve connection egress bucket";
      lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
      continue;
    }
    const gate = evaluateCircuit(provider, bucket);
    if (!gate.allowed) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = "Selected provider route is cooling down";
      lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
      continue;
    }
    let releaseSlot = null;
    let resilienceTerminalEventFired = false;
    try {
      releaseSlot = await acquireAccountSlot({ provider, connectionId: credentials.connectionId, bucket, maxConcurrency: refreshedCredentials.providerSpecificData?.maxConcurrency, warn: (message) => log.warn("RESILIENCE", message) });
    } catch (error) {
      log.warn("RESILIENCE", `${provider}/${model} account capacity unavailable; trying next account`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = error.message;
      lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
      continue;
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
      onResilienceEvent: (event, details) => {
          if (event === "DISPATCH_FAILED" || event === "STREAM_COMPLETED" || event === "STREAM_FAILED" || event === "CLIENT_ABORTED" || event === "NON_STREAM_COMPLETED") {
            resilienceTerminalEventFired = true;
            releaseSlot?.();
           releaseSlot = null;
         }
         recordCircuitOutcome({ provider, bucket, outcome: event, ...details });
       }
      });

      if (!resilienceTerminalEventFired && !result.success && releaseSlot) {
        releaseSlot();
       releaseSlot = null;
     }

     if (result.success) return result.response;

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

async function dispatchChatAttempt({ body, provider, model, credentials, log, clientRawRequest, request, apiKey, userAgent }) {
  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
  const proxyData = refreshedCredentials.providerSpecificData || {};
  const resolvedProxy = proxyData.proxyPoolId || proxyData.connectionProxyPoolId
    ? { source: proxyData.vercelRelayUrl ? "vercel" : "pool", proxyPoolId: proxyData.proxyPoolId || proxyData.connectionProxyPoolId }
    : await resolveConnectionProxyConfig(proxyData, credentials.connectionId);
  const bucket = getProxyBucketIdentity(resolvedProxy);
  if (!bucket) return { success: false, status: HTTP_STATUS.SERVICE_UNAVAILABLE, error: "Unable to resolve Freebuff proxy bucket", poolScoped: { poolId: credentials.providerSpecificData?.proxyPoolId } };
  const gate = evaluateCircuit(provider, bucket);
  if (!gate.allowed) return { success: false, status: HTTP_STATUS.SERVICE_UNAVAILABLE, error: "Freebuff proxy pool circuit is cooling down", poolScoped: { poolId: credentials.providerSpecificData?.proxyPoolId } };
  let releaseSlot;
  try {
    releaseSlot = await acquireAccountSlot({ provider, connectionId: credentials.connectionId, bucket, maxConcurrency: refreshedCredentials.providerSpecificData?.maxConcurrency, warn: (message) => log.warn("RESILIENCE", message) });
  } catch (error) {
    return { success: false, status: HTTP_STATUS.SERVICE_UNAVAILABLE, error: error.message, poolScoped: { poolId: credentials.providerSpecificData?.proxyPoolId } };
  }
  const onResilienceEvent = (event, details) => {
    if (["DISPATCH_FAILED", "STREAM_COMPLETED", "STREAM_FAILED", "CLIENT_ABORTED", "NON_STREAM_COMPLETED"].includes(event)) {
      releaseSlot?.();
      releaseSlot = null;
    }
    recordCircuitOutcome({ provider, bucket, outcome: event, ...details });
  };
  const chatSettings = await getSettings();
  const result = await handleChatCore({
    body: { ...body, model: `${provider}/${model}` }, modelInfo: { provider, model }, credentials: refreshedCredentials, log,
    clientRawRequest, connectionId: credentials.connectionId, userAgent, apiKey,
    ccFilterNaming: !!chatSettings.ccFilterNaming, rtkEnabled: !!chatSettings.rtkEnabled,
    headroomEnabled: !!chatSettings.headroomEnabled, headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
    headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
    cavemanEnabled: !!chatSettings.cavemanEnabled, cavemanLevel: chatSettings.cavemanLevel || "full",
    ponytailEnabled: !!chatSettings.ponytailEnabled, ponytailLevel: chatSettings.ponytailLevel || "full",
    pxpipeEnabled: !!chatSettings.pxpipeEnabled, pxpipeMinChars: chatSettings.pxpipeMinChars, pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
    pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null, onPxpipeEvent: appendPxpipeEvent,
    providerThinking: (chatSettings.providerThinking || {})[provider] || null,
    sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
    onCredentialsRefreshed: async (newCreds) => updateProviderCredentials(credentials.connectionId, { ...newCreds, existingProviderSpecificData: credentials.providerSpecificData, testStatus: "active" }),
     onRequestSuccess: async () => clearAccountError(credentials.connectionId, credentials, model),
     onResilienceEvent,
   });
  if (!result.success && releaseSlot) {
    releaseSlot();
    releaseSlot = null;
  }
  return result;
}
