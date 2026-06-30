import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  isProviderAccountUnavailableError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, isContextWindowError, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS, jitteredBackoff } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";

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
  cacheClaudeHeaders(clientRawRequest.headers);

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

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

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
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
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
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
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

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  const RESCAN_BUDGET_MS = 60 * 1000;
  const providerAccountUnavailableRetryEnabled = provider === "kiro" || provider.startsWith("openai-compatible-") || provider.startsWith("anthropic-compatible-");
  const rescanDeadline = Date.now() + RESCAN_BUDGET_MS;
  let rescanRound = 0;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      const retryableContention = credentials?.allRateLimited === true
        || isProviderAccountUnavailableError(lastStatus, lastError)
        || (provider === "kiro" && lastStatus === HTTP_STATUS.RATE_LIMITED);
      if (providerAccountUnavailableRetryEnabled && retryableContention && Date.now() < rescanDeadline) {
        rescanRound++;
        const waitMs = Math.min(
          jitteredBackoff(rescanRound, { baseDelayMs: 600, maxDelayMs: 5000, jitterRatio: 0.4 }),
          Math.max(0, rescanDeadline - Date.now())
        );
        log.info("CHAT", `[${provider}/${model}] provider accounts busy, rescan ${rescanRound} after ${Math.round(waitMs)}ms`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        excludeConnectionIds.clear();
        continue;
      }

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

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

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
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    // Kiro request-contention mode: "balance" (default) | "stress"
    const kiroMode = provider === "kiro"
      ? ((chatSettings.providerStrategies || {}).kiro?.kiroMode || "balance")
      : undefined;

    // Run a single account attempt. `creds`/`refreshed` are the chosen account;
    // `externalSignal` lets a hedged race abort the loser mid-flight.
    const runAttempt = (creds, refreshed, externalSignal) => handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshed,
      log,
      clientRawRequest,
      connectionId: creds.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      providerThinking,
      kiroMode,
      externalSignal,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(creds.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(creds.connectionId, creds, model);
      }
    });

    // STRESS-mode hedging: when Kiro is in "stress" mode and a second account is
    // free, fire both in parallel and take the first success, aborting the
    // loser. This roughly doubles upstream load (and quota burn) but wins the
    // slot race far more often under heavy contention.
    let result;
    let secondCreds = null;
    if (kiroMode === "stress") {
      secondCreds = await getProviderCredentials(
        provider,
        new Set([...excludeConnectionIds, credentials.connectionId]),
        model
      );
    }

    if (secondCreds && !secondCreds.allRateLimited && secondCreds.connectionId) {
      const secondRefreshed = await checkAndRefreshToken(provider, secondCreds);
      log.info("AUTH", `\x1b[35m[STRESS] hedging ${credentials.connectionName} + ${secondCreds.connectionName}\x1b[0m`);
      result = await runHedged(
        [
          { creds: credentials, refreshed: refreshedCredentials },
          { creds: secondCreds, refreshed: secondRefreshed }
        ],
        runAttempt,
        async (loserCreds, loserResult) => {
          // Loser failed (or was aborted) — cool it down briefly so rotation
          // skips it on the next pass, mirroring the normal failure path.
          if (loserResult && !loserResult.success) {
            await markAccountUnavailable(loserCreds.connectionId, loserResult.status, loserResult.error, provider, model, loserResult.resetsAtMs);
          }
        },
        log
      );
      // If both lost, exclude both so the loop advances.
      if (!result.success) {
        excludeConnectionIds.add(secondCreds.connectionId);
      }
    } else {
      result = await runAttempt(credentials, refreshedCredentials, undefined);
    }

    if (result.success) return result.response;

    if (isContextWindowError(result.status, result.error)) {
      return result.response;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/**
 * Race multiple account attempts in parallel; return the first that succeeds
 * and abort the rest. If none succeed, return the last failure.
 *
 * Each candidate gets its own AbortController so the losers can be torn down
 * cleanly (the signal is forwarded into handleChatCore's stream controller).
 *
 * @param {Array<{creds:object, refreshed:object}>} candidates
 * @param {(creds, refreshed, signal) => Promise<object>} runAttempt
 * @param {(loserCreds, loserResult) => Promise<void>} onLoser - cleanup hook
 * @param {object} log
 */
async function runHedged(candidates, runAttempt, onLoser, log) {
  const controllers = candidates.map(() => new AbortController());
  const settled = new Array(candidates.length).fill(false);

  const attempts = candidates.map((c, i) =>
    runAttempt(c.creds, c.refreshed, controllers[i].signal)
      .then(result => ({ i, result }))
      .catch(error => ({ i, result: { success: false, status: 502, error: error?.message || String(error) } }))
  );

  let firstFailure = null;
  const pending = attempts.map((p, idx) => p.then(v => ({ v, idx })));
  const remaining = new Set(pending.map((_, idx) => idx));

  while (remaining.size > 0) {
    const { v, idx } = await Promise.race([...remaining].map(i => pending[i]));
    remaining.delete(idx);
    settled[v.i] = true;

    if (v.result.success) {
      // Winner found — abort all other in-flight attempts.
      controllers.forEach((ctrl, j) => {
        if (j !== v.i && !settled[j]) {
          try { ctrl.abort(); } catch { /* noop */ }
        }
      });
      // Best-effort cleanup of losers (cooldown) in the background.
      candidates.forEach((c, j) => {
        if (j !== v.i) {
          Promise.resolve(attempts[j]).then(other => onLoser?.(c.creds, other?.result)).catch(() => {});
        }
      });
      return v.result;
    }

    if (!firstFailure) firstFailure = v;
    else Promise.resolve(onLoser?.(candidates[v.i].creds, v.result)).catch(() => {});
  }

  // All lost — surface the first failure.
  return firstFailure ? firstFailure.result : { success: false, status: 502, error: "All hedged attempts failed" };
}
