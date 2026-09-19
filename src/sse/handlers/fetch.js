import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { handleFetchCore } from "open-sse/handlers/fetch/index.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { recordModalityUsage, estimateTextTokens } from "../utils/mediaUsage.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { getComboModels } from "../services/model.js";
import { getComboByName } from "@/lib/localDb";
import { assertPublicUrlResolved } from "@/shared/utils/ssrfGuard.js";
import { assertWebComboKind, resolveWebProviderId, runWebCombo } from "../services/webRouting.js";

/**
 * Web-fetch token policy (audit T1.8 F4): a fetch is not a generation, so the
 * request side is the URL the client asked for and the output side is the text
 * the provider actually handed back.
 */
function webFetchTokens(targetUrl, data) {
  const text = typeof data?.content?.text === "string" ? data.content.text : "";
  return {
    prompt_tokens: estimateTextTokens(targetUrl),
    completion_tokens: estimateTextTokens(text),
  };
}

/**
 * Handle web fetch (URL extraction) request for the SSE/Next.js server.
 * Provider IS the model. Mirrors handleEmbeddings auth + fallback flow.
 *
 * @param {Request} request
 */
export async function handleFetch(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("FETCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const reqUrl = new URL(request.url);
  // Accept either `provider` or `model` (UI sends `model` since provider IS the model for webFetch)
  const providerInput = body.provider || body.model;
  const targetUrl = body.url;
  const format = body.format;
  const maxCharacters = body.max_characters;

  log.request("POST", `${reqUrl.pathname} | ${providerInput}`);

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

  if (!providerInput || typeof providerInput !== "string") {
    log.warn("FETCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (!targetUrl || typeof targetUrl !== "string") {
    log.warn("FETCH", "Missing url");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: url");
  }

  // Validate URL format
  try {
    new URL(targetUrl);
  } catch {
    log.warn("FETCH", "Invalid URL", { url: targetUrl });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid URL format");
  }

  // SSRF guard: reject internal/private/metadata targets, including
  // hostnames that merely resolve to one (DNS lookup, not just literal checks).
  try {
    await assertPublicUrlResolved(targetUrl);
  } catch (err) {
    log.warn("FETCH", "Blocked URL", { url: targetUrl });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, err.message);
  }

  // Combo expansion: providerInput may be a combo name → run fallback/round-robin across providers.
  // Use the local catalog-aware path so unavailable members are skipped (same as chat).
  const comboModels = await getComboModels(providerInput);
  if (comboModels?.length) {
    const combo = await getComboByName(providerInput);
    const kindCheck = assertWebComboKind(combo, providerInput, "webFetch");
    if (!kindCheck.ok) {
      log.warn("FETCH", kindCheck.error);
      return errorResponse(HTTP_STATUS.BAD_REQUEST, kindCheck.error);
    }
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[providerInput]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("FETCH", `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return runWebCombo({
      capability: "webFetch",
      body,
      models: comboModels,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit,
      handleSingleProvider: (b, m) => handleSingleProviderFetch(b, m, request, apiKey, settings),
      handleComboChat,
      log,
    });
  }

  return handleSingleProviderFetch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderFetch(body, providerInput, request, apiKey, settings) {
  const targetUrl = body.url;
  const endpoint = new URL(request.url).pathname;
  const format = body.format;
  const maxCharacters = body.max_characters;
  const resolved = resolveWebProviderId(providerInput, "webFetch");
  if (!resolved.ok) {
    log.warn("FETCH", resolved.error, { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, resolved.error);
  }
  const providerId = resolved.providerId;
  const resolvedProvider = AI_PROVIDERS[providerId];
  const providerConfig = resolvedProvider.fetchConfig;

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  // No-auth fetch path (kept for parity though no current fetch provider sets noAuth)
  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: resolvedProvider.id,
      providerConfig,
      credentials: null,
      log
    });
    if (result.success) {
      recordModalityUsage({
        provider: providerId, model: providerId, endpoint, apiKey,
        tokens: webFetchTokens(targetUrl, result.data),
      });
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Fetch failed");
  }

  // Credential + fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  // Keep web-fetch failures scoped to this capability. Providers such as
  // Ollama use the same connection for chat and fetch, so an upstream fetch
  // failure must not take the account offline for LLM requests.
  const fetchLockKey = `webfetch:${providerId}`;

  while (true) {
    const credentials = await getProviderCredentials(providerId, excludeConnectionIds, fetchLockKey);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("FETCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("FETCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: resolvedProvider.id,
      providerConfig,
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      }
    });

    if (result.success) {
      await clearAccountError(credentials.connectionId, credentials, fetchLockKey);
      recordModalityUsage({
        provider: providerId, model: providerId, endpoint, apiKey, connectionId: credentials.connectionId,
        tokens: webFetchTokens(targetUrl, result.data),
      });
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      providerId,
      fetchLockKey,
    );

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Fetch failed");
  }
}
