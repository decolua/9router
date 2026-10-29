import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings, getProviderConnections, getCustomModels } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isValidModel } from "@/shared/constants/models.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { isOpenAICompatibleProvider } from "@/shared/constants/providers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";

// DF-9ROUTER-54 — a fresh install advertises only the models that work with no
// stored connection (buildModelsList in src/app/api/v1/models/route.js filters
// the catalog to providers that need no credentials), yet a chat request naming
// any other provider answered a bare 404 "No active credentials for provider: X"
// with nothing pointing at that catalog. The 404 is exactly the moment the
// pointer is worth most, so the message carries it — plus, when the DB is
// readable, the providers that DO have a connection, which separates "nothing is
// configured on this instance" from "this one provider is not".
//
// The prefix is unchanged ("No active credentials for provider: X") so existing
// clients and log greps keep matching; only guidance is appended.
const MAX_NO_CREDENTIALS_MESSAGE_CHARS = 200;
const NO_CREDENTIALS_DISCOVERY = " See /v1/models for models usable without credentials.";
const MAX_NAMED_CONFIGURED_PROVIDERS = 5;

/**
 * Compose the 404 body for a provider with no usable stored connection.
 * Pure — `configuredProviders` is the caller's best-effort lookup (null when it
 * failed, so the guidance is never lost to a DB hiccup).
 * Budget: the discovery pointer is mandatory, the provider list is optional and
 * is dropped rather than letting the message reach
 * MAX_NO_CREDENTIALS_MESSAGE_CHARS.
 * @param {string} provider - provider id/alias as routed
 * @param {string[]|null} [configuredProviders] - providers with a stored connection
 * @returns {string} OpenAI-compatible error message
 */
export function noCredentialsMessage(provider, configuredProviders = null) {
  const base = `No active credentials for provider: ${provider}.`;
  const discovery = `${base}${NO_CREDENTIALS_DISCOVERY}`;
  const names = (Array.isArray(configuredProviders) ? configuredProviders : [])
    .filter((name) => typeof name === "string" && name.length > 0);
  if (names.length === 0) return discovery;

  const shown = names.slice(0, MAX_NAMED_CONFIGURED_PROVIDERS);
  const ellipsis = names.length > shown.length ? ", …" : "";
  const withList = `${base} Active connections exist for: ${shown.join(", ")}${ellipsis}.${NO_CREDENTIALS_DISCOVERY}`;
  return withList.length < MAX_NO_CREDENTIALS_MESSAGE_CHARS ? withList : discovery;
}

/**
 * Compose the 404 message for an id the instance's own catalog cannot name —
 * pure, exported for tests. Mirrors the fresh-install contract: the id a
 * client was told to call is /v1/models, so the error points there, and it
 * does NOT name credentials (a catalog miss is a wrong model name, not a dead
 * key). Budgeted like noCredentialsMessage.
 * @param {string} modelStr - the model id exactly as the client sent it
 * @returns {string} OpenAI-compatible error message
 */
export function modelNotInCatalogMessage(modelStr) {
  return `Model '${modelStr}' not found in catalog. See /v1/models for models usable without credentials.`;
}

/**
 * Best-effort check: can `provider/model` exist on this instance at all?
 * Reads the SAME catalog surfaces GET /v1/models advertises (static registry
 * under the provider's alias, custom models on that provider). Live resolvers
 * (kiro/qoder/github/…) are deliberately NOT consulted — an unresolvable id
 * has usually already failed one credential lookup, and the 404 must not
 * depend on a second network call succeeding.
 *
 * Semantics, chosen so the error path can never erase a real routing case:
 *   false — DEFINITIVE miss: registered provider, no active connection, and
 *           the id is in neither its static list nor its custom models. On
 *           this instance the id cannot resolve, so blaming credentials would
 *           be wrong (this is exactly the fresh-install 404 state).
 *   null  — UNKNOWN: openai-compatible NODE (catalog = its upstream's,
 *           discovered live — unknowable here), a connection that exists (a
 *           passthrough/compat node can name anything), a failed DB read, or
 *           an unregistered provider prefix. Every null degrades to the
 *           legacy credential wording.
 * @param {string} provider - provider id/alias as routed
 * @param {string} model - unprefixed model id
 * @returns {Promise<boolean|null>} false = definitively not in catalog, null = unknown
 */
async function modelResolvableInCatalog(provider, model) {
  // A NODE's catalog is its upstream's, discovered live at /v1/models time;
  // this static read cannot prove a miss for one.
  if (isOpenAICompatibleProvider(provider)) return null;
  let connections;
  try {
    connections = await getProviderConnections({ provider });
  } catch {
    return null;
  }
  const hasConnection = (connections || []).some((c) => c?.provider === provider && c.isActive !== false);
  // A connection exists: the provider is passthrough/compatible in practice —
  // its model set is whatever the upstream accepts. Not provable statically.
  if (hasConnection) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  // An unregistered provider prefix is not provable here — alias/combo
  // resolution ran earlier, so this is a node-ish or future id: unknown.
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, alias)) return null;
  // Definitive-miss test: absent from the static registry AND from the
  // custom models published under this provider. Any read failure is unknown.
  const inStatic = isValidModel(alias, model);
  let inCustom = false;
  try {
    const customs = await getCustomModels();
    inCustom = (customs || []).some((m) => {
      if (!m?.id || String(m.id).trim() !== model) return false;
      const providerAlias = m.providerAlias;
      return providerAlias === alias || providerAlias === provider;
    });
  } catch {
    return null;
  }
  return inStatic || inCustom ? null : false;
}

/**
 * Best-effort list of providers that currently have a stored (active)
 * connection. Returns null when the lookup fails — the 404 guidance must not
 * depend on a second DB read succeeding in the error path.
 */
async function configuredProviderIds() {
  try {
    const connections = await getProviderConnections();
    const ids = [];
    for (const connection of connections || []) {
      if (!connection?.provider || connection.isActive === false) continue;
      if (!ids.includes(connection.provider)) ids.push(connection.provider);
    }
    return ids;
  } catch {
    return null;
  }
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

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

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

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

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
    const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings), comboModels);
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
    const comboCfg = comboStrategies[modelStr] || {};
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      sessionId,
      smartPolicy: comboCfg.smartPolicy || "smart",
      sessionSticky: comboCfg.sessionSticky !== false,
      confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
      resolveSmartChoice: comboStrategy === "smart"
        ? (b, m) => resolveSmartChoice({
            body: b,
            models: m,
            routerModel: comboCfg.routerModel,
            log,
          })
        : null,
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
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

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null) {
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
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = await getKeyAccessContext(request);
      const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings), comboModels);
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
      const comboCfg = comboStrategies[modelStr] || {};
      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
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
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        // Nothing has been tried-and-excluded, so this is not "all accounts
        // exhausted" — the provider has no usable stored connection on this
        // instance. DF-9ROUTER-56: before blaming credentials, ask whether the
        // requested id can exist on this instance at all. A model absent from
        // the same catalog GET /v1/models advertises is a WRONG MODEL NAME,
        // not a missing connection — saying "No active credentials for
        // provider: X" there sends users hunting for a dead API key. The
        // credential wording is kept only for ids the catalog actually lists
        // (combo/alias resolution and node passthrough both land here), where
        // a connection really is what is missing. Same 404 / model_not_found
        // either way — only the message changes.
        const modelInCatalog = await modelResolvableInCatalog(provider, model);
        if (modelInCatalog === false) {
          const message = modelNotInCatalogMessage(modelStr);
          log.warn("CHAT", message);
          return errorResponse(HTTP_STATUS.NOT_FOUND, message);
        }
        // Say so with a pointer at the model discovery surface
        // (and the providers that ARE configured) instead of a dead end.
        const message = noCredentialsMessage(provider, await configuredProviderIds());
        log.warn("AUTH", message);
        return errorResponse(HTTP_STATUS.NOT_FOUND, message);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
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
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
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
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) return result.response;

    // DF-9ROUTER-40 — on an OpenAI-compatible NODE a 404/406 is model-scoped
    // by construction: the node's credential demonstrably worked (the request
    // reached the upstream and was routed), so the model id simply does not
    // resolve there. A chained 9router reports exactly this with credential
    // wording — it receives the bare remainder, infers provider `openai` for
    // the unknown id, and answers "No active credentials for provider:
    // openai". Left to the generic account classifier, that wording matches
    // the "no credentials" rule: the VALID connection is cooled down and the
    // caller waits out the retry window for a misleading answer (measured
    // ~95s in the 2026-09-24 dogfood). Surface the honest verdict immediately
    // instead — no cooldown, no next account (every account on this node
    // speaks to the same upstream), naming the id the caller asked for.
    // Non-node providers keep the generic classification: their 404 can be a
    // genuine credential/routing failure and stays account-scoped.
    if (
      (result.status === HTTP_STATUS.NOT_FOUND || result.status === HTTP_STATUS.NOT_ACCEPTABLE)
      && isOpenAICompatibleProvider(provider)
    ) {
      log.warn("CHAT", `[${provider}/${model}] upstream node answered ${result.status} — model id does not resolve there (upstream said: ${String(result.error || "").slice(0, 120)})`);
      return errorResponse(result.status, `Model not found on upstream node: ${modelStr}`);
    }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
