import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
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
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import {
  acquire,
  resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency,
  isSemaphoreCapacityError,
} from "open-sse/services/accountSemaphore.js";
import {
  getCircuitBreaker,
  buildAccountBreakerName,
  recordFailure,
  recordSuccess,
  canExecute,
  settleProbe,
  shouldRecordBreakerFailure,
  STATE,
} from "open-sse/utils/circuitBreaker.js";

// Concurrency-gate budgets (the gate itself is open-sse/services/accountSemaphore.js).
//
// PROBE: how long to wait for a slot while OTHER accounts might be free. Short
// on purpose — giving up fast is how load spreads across accounts.
// WAIT: how long to wait when this is the only account left. A request the
// gateway throttles is not a provider failure, and long upstream calls (tens of
// seconds are normal) must not turn into a false "all accounts unavailable".
// Read per request so it can be tuned without a restart.
const CAPACITY_PROBE_MS = 2000;
const CAPACITY_WAIT_DEFAULT_MS = 60_000;

function resolveCapacityWaitMs() {
  const raw = Number(process.env.ACCOUNT_CAPACITY_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : CAPACITY_WAIT_DEFAULT_MS;
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
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
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

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

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels?.length) {
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
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    // D13/CB2: scratch the combo loop fills per attempt and this file stamps
    // with the account it dispatches to. Passing it is what opts this loop into
    // combo-attributed usage (failure line per attempted member + meta.combo on
    // the winner) — only REAL combos do, never the capability adapter below.
    const attemptUsage = {
      comboName: modelStr,
      // Chain of combo names already expanded in this request (see the cyclic
      // guard in handleSingleModelChat).
      comboPath: [modelStr],
      apiKey: apiKey || undefined,
      endpoint: clientRawRequest?.endpoint || undefined,
    };
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, attemptUsage),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      attemptUsage,
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
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
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
/**
 * @param {Object} [attemptUsage] - Combo-attempt scratch handed over by the
 *   combo branch above (D13/CB2). Stamped here with the account this attempt is
 *   dispatched to, and `reachedUpstream` flipped only once the breaker/capacity
 *   gates are behind us — that is what separates "this member failed" from
 *   "this member was never called", and only the former earns a usage line.
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptUsage = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    // CYCLIC-COMBO GUARD (found while testing D13/CB2, not introduced by it):
    // a member list may name a combo again, and nothing on save forbids a combo
    // that contains itself (or A→B→A). Without this check handleSingleModelChat
    // re-enters handleComboChat for the same name forever and the process dies
    // with a heap OOM — a request-triggerable crash from dashboard data.
    // A repeat in the chain is treated as "not a combo", which falls through to
    // the existing 400 below instead of looping.
    const comboPath = attemptUsage?.comboPath || [];
    if (comboModels?.length && comboPath.includes(modelStr)) {
      log.warn("CHAT", `Cyclic combo reference ignored: "${modelStr}" already expanded in this request`, { comboPath });
    } else if (comboModels?.length) {
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
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      const attemptUsage = {
        comboName: modelStr,
        comboPath: [...comboPath, modelStr],
        apiKey: apiKey || undefined,
        endpoint: clientRawRequest?.endpoint || undefined,
      };
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, attemptUsage),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        attemptUsage,
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

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  // Accounts skipped ONLY because the gateway's own concurrency gate was full.
  // They are healthy — see the capacity handling below.
  const capacityDeferred = new Set();
  const capacityExhausted = new Set();
  let capacityWaitPhase = false;
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      // Capacity is NOT unavailability. Skipping a full account to try another
      // one spreads load; but when there is no other account left, giving up
      // reports "all accounts unavailable" for an account that is perfectly
      // healthy and never even got called. Re-admit those and wait for a slot.
      if (!capacityWaitPhase && capacityDeferred.size > 0) {
        capacityWaitPhase = true;
        for (const id of capacityDeferred) excludeConnectionIds.delete(id);
        log.info("CHAT", `[${provider}/${model}] no other account free — waiting up to ${resolveCapacityWaitMs()}ms for a slot`);
        continue;
      }
      if (capacityExhausted.size > 0) {
        const msg = `[${provider}/${model}] Account at capacity: concurrency gate full for ${resolveCapacityWaitMs()}ms (the provider was never called)`;
        log.warn("CHAT", msg);
        return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, msg);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      // Do not surface a stale lastStatus 401/403 after the account list is exhausted.
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
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

    // Gate per-account (skip noauth / missing connectionId)
    const connectionId = credentials.connectionId;
    const isNoAuth = !connectionId || connectionId === "noauth";

    let breakerName = null;
    if (!isNoAuth) {
      breakerName = buildAccountBreakerName({
        provider,
        connectionId,
        model,
      });
      if (!getCircuitBreaker(breakerName)) {
        getCircuitBreaker(breakerName, {
          failureThreshold: 5,
          resetTimeout: 30_000,
          // 5 provider failures within 2 minutes means the model is actually
          // down on this account. Counting them cumulatively meant five blips
          // spread over a day tripped an account that was working fine.
          failureWindowMs: 120_000,
          isFailure: (err) => shouldRecordBreakerFailure(err?.statusCode),
        });
      }
    }

    // Acquire semaphore first so a short capacity timeout doesn't burn a
    // HALF_OPEN probe (canExecute consumes halfOpenRemaining).
    const semaphoreKey = resolveAccountSemaphoreKey({
      provider,
      connectionId,
    });
    const semaphoreMax = resolveAccountSemaphoreMaxConcurrency(refreshedCredentials);
    let semaphoreRelease = () => {};
    if (semaphoreKey && semaphoreMax != null) {
      try {
        semaphoreRelease = await acquire(semaphoreKey, {
          maxConcurrency: semaphoreMax,
          // Probe briefly while other accounts may be free; wait properly once
          // this is the last one standing.
          timeoutMs: capacityWaitPhase ? resolveCapacityWaitMs() : CAPACITY_PROBE_MS,
        });
        capacityDeferred.delete(connectionId);
      } catch (e) {
        if (isSemaphoreCapacityError(e)) {
          if (!capacityWaitPhase) {
            log.warn("AUTH", `Account ${credentials.connectionName} at capacity, trying fallback`);
            capacityDeferred.add(connectionId);
            excludeConnectionIds.add(connectionId);
            continue;
          }
          log.warn("AUTH", `Account ${credentials.connectionName} still at capacity after ${resolveCapacityWaitMs()}ms`);
          capacityExhausted.add(connectionId);
          excludeConnectionIds.add(connectionId);
          continue;
        }
        throw e;
      }
    }

    // Only consume HALF_OPEN probe on a real upstream attempt.
    if (breakerName && !canExecute(breakerName)) {
      semaphoreRelease();
      excludeConnectionIds.add(connectionId);
      continue;
    }

    let holdSemaphore = false;
    const releaseOnce = () => {
      const release = semaphoreRelease;
      semaphoreRelease = () => {};
      release();
    };
    // RM7 (T1.1): one settle per request. A single latch gates every
    // outcome-recording path (stream completion, client disconnect, error
    // result, and the new exception catch) so the attempt can record its
    // breaker outcome exactly once — never a double decrement/settle when
    // racing lifecycle callbacks fire after the loop already moved on.
    let settled = false;
    const settleOutcome = () => {
      if (settled) return false;
      settled = true;
      return true;
    };

    try {
      // Use shared chatCore
      const chatSettings = await getSettings();
      // Past the breaker/capacity gates: this attempt really is a call.
      if (attemptUsage) {
        attemptUsage.reachedUpstream = true;
        attemptUsage.connectionId = connectionId;
      }
      const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
      const result = await handleChatCore({
        body: { ...body, model: `${provider}/${model}` },
        modelInfo: { provider, model },
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId,
        userAgent,
        apiKey,
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        headroomEnabled: !!chatSettings.headroomEnabled,
        headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
        headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
        headroomTimeoutMs: chatSettings.headroomTimeoutMs,
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
        // D13/CB2: combo identity for the winning member's usage row.
        comboName: attemptUsage?.comboName || null,
        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(connectionId, {
            ...newCreds,
            existingProviderSpecificData: credentials.providerSpecificData,
            testStatus: "active"
          });
        },
        onRequestSuccess: async () => {
          await clearAccountError(connectionId, credentials, model);
          clearAntigravityStrikes(connectionId, model);
        },
        onStreamComplete: () => {
          if (settleOutcome() && breakerName) recordSuccess(breakerName);
          releaseOnce();
        },
        onDisconnect: () => {
          if (settleOutcome() && breakerName) {
            // RH1: an aborted stream never reaches onStreamComplete, so the
            // HALF_OPEN probe consumed by canExecute() above would stay
            // in-flight (no slot, no outcome) until the breaker's probe
            // safety timer. Settle it now as a conservative failure. No-op
            // unless a probe is outstanding — CLOSED disconnects never count.
            settleProbe(breakerName, "client disconnect");
          }
          releaseOnce();
        },
      });

      if (result.success) {
        const contentType = result.response?.headers?.get?.("content-type") || "";
        // Hold only for actual SSE. body.stream can be true while chatCore
        // returns JSON (e.g. image-gen forced stream=false).
        const isStreaming = contentType.toLowerCase().includes("text/event-stream");
        if (isStreaming) {
          holdSemaphore = true;
          return result.response;
        }
        if (breakerName && settleOutcome()) recordSuccess(breakerName);
        return result.response;
      }

      // Breaker accounting: HALF_OPEN must not stay at 0 with no outcome.
      // 5xx/timeout re-opens; 401/403/429 mean provider is up, so close.
      if (breakerName && settleOutcome()) {
        const cb = getCircuitBreaker(breakerName);
        const isHalfOpenProbe = cb?.getStatus?.().state === STATE.HALF_OPEN;
        if (isHalfOpenProbe) {
          if (shouldRecordBreakerFailure(result.status)) {
            recordFailure(breakerName, { statusCode: result.status });
          } else if (result.status === 401 || result.status === 403 || result.status === 429) {
            recordSuccess(breakerName);
          } else if (!shouldRecordBreakerFailure(result.status)) {
            // Any other non-5xx while HALF_OPEN should also close the probe
            // so it doesn't stay stuck at 0. Treat as success.
            recordSuccess(breakerName);
          }
        } else if (shouldRecordBreakerFailure(result.status)) {
          recordFailure(breakerName, { statusCode: result.status });
        }
      }

      // Antigravity 409/429: refresh live quota to get exact resetAt before locking
      let quotaResetMs = null;
      let resetsAtMs = result.resetsAtMs;
      if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
        quotaResetMs = await handleAntigravityQuotaError(
          connectionId, result.status, model,
          refreshedCredentials.accessToken, credentials.providerSpecificData
        );
        if (quotaResetMs) resetsAtMs = quotaResetMs;
      }

      // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
      // Do not persist a modelLock_* for this path.
      const shouldFallback = provider === "antigravity" && quotaResetMs
        ? true
        : (await markAccountUnavailable(connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

      if (shouldFallback) {
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
        excludeConnectionIds.add(connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }

      return result.response;
    } catch (error) {
      // RH4 (T1.1): handleChatCore has throw-capable call sites outside its
      // own try (translateRequest, createRequestLogger, and
      // pipeWithDisconnect's TypeError on a 204/205 body), and the quota /
      // account-lock bookkeeping below can throw on DB errors too. Without
      // this catch one bad account killed the whole fallback chain as a raw
      // HTML 500 from the route handler and left the HALF_OPEN probe
      // stranded with no outcome.
      const status = error?.statusCode ?? error?.status ?? null;
      const message = error?.message || String(error);
      log.error("CHAT", `[${provider}/${model}] Account ${credentials.connectionName} threw${status ? ` (${status})` : ""}: ${message}`);
      // Exactly one settle per request (shared latch with the callbacks).
      // A provider-classified status opens the breaker like the error-result
      // path; anything else is not the provider's fault (CLOSED-state rule)
      // but still must resolve an outstanding HALF_OPEN probe — settleProbe
      // is a no-op otherwise.
      if (breakerName && settleOutcome()) {
        if (shouldRecordBreakerFailure(status)) {
          recordFailure(breakerName, { statusCode: status });
        } else {
          settleProbe(breakerName, `account loop exception: ${message}`);
        }
      }
      // The pending counter is deliberately NOT touched here: whether the
      // +1 (chatCore.js:343) already happened depends on where chatCore
      // threw, and a blind compensating -1 would steal a live request's
      // credit (RM7). A straggler is bounded by usageRepo's PENDING_TIMEOUT.
      excludeConnectionIds.add(connectionId);
      capacityDeferred.delete(connectionId);
      lastError = message;
      lastStatus = status;
      continue;
    } finally {
      if (!holdSemaphore) releaseOnce();
    }
  }
}
