import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable, clearAccountError,
} from "../services/auth.js";
import { getSettings, getCustomModels } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { getKeyAccessContext, enforceKeyAccess } from "../services/keyAccess.js";
import { handleTtsCore } from "open-sse/handlers/ttsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { handleComboChat } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { runSpeechInference } from "./speechUsage.js";

// Derived from providers.js: any TTS provider not noAuth requires stored credentials
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("tts") && !p.noAuth && p.ttsConfig?.authType !== "none")
    .map(([id]) => id)
);

export async function handleTts(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  const responseFormat = url.searchParams.get("response_format") || body.response_format || "mp3"; // mp3 (default) | json
  const language = body.language || ""; // Optional language hint (currently used by Gemini)
  const style = body.style || ""; // Optional style/voice instructions (e.g. Xiaomi MiMo)
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ""}`);

  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  const usageContext = { apiKey, endpoint: url.pathname };
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  // Per-key access control: requested target, before combo expansion.
  const keyAccessDenied = await enforceKeyAccess(await getKeyAccessContext(request), modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[modelStr]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("TTS", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelTts(b, m, responseFormat, language, style, request.signal, usageContext),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelTts(body, modelStr, responseFormat, language, style, request.signal, usageContext);
}

async function handleSingleModelTts(body, modelStr, responseFormat, language, style, signal, usageContext) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  const customModels = await getCustomModels();
  const alias = getProviderAlias(provider);
  const modelConfig = customModels.filter((m) => m.type === "tts" && (m.providerAlias === alias || m.providerAlias === provider) && (model === m.id || model.startsWith(`${m.id}/`))).sort((a, b) => b.id.length - a.id.length)[0];
  const upstreamFormat = body.upstream_response_format ?? (modelConfig?.upstreamFormat || undefined);
  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);

  // noAuth providers — no credential needed
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await runSpeechInference(handleTtsCore, { provider, model, input: body.input, responseFormat, upstreamFormat, language, style, voice: body.voice, signal }, usageContext);
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed");
  }

  // Credentialed providers — fallback loop (same pattern as embeddings)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    let credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        if (provider === "ollama-local") {
          const result = await runSpeechInference(handleTtsCore, { provider, model, input: body.input, credentials: null, responseFormat, upstreamFormat, language, style, signal }, usageContext);
          if (result.success) return result.response;
          return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed");
        }
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    let result;
    try {
      if (provider === "codex") credentials = await checkAndRefreshToken(provider, credentials);
      const proxyOptions = ["codex", "pollinations"].includes(provider) ? await resolveConnectionProxyConfig(credentials._connection?.providerSpecificData || credentials.providerSpecificData) : undefined;
      const args = { provider, model, input: body.input, credentials, responseFormat, upstreamFormat, language, style, voice: body.voice, signal, proxyOptions };
      result = await runSpeechInference(handleTtsCore, args, usageContext);
      if (provider === "codex" && result.status === 401 && credentials.refreshToken && !signal.aborted) {
        const previous = credentials.accessToken;
        credentials = await checkAndRefreshToken(provider, credentials, { force: true });
        if (credentials.accessToken !== previous) result = await runSpeechInference(handleTtsCore, { ...args, credentials }, usageContext);
      }
      if (result.success && provider === "codex") await clearAccountError(credentials.connectionId, credentials, model);
    } catch {
      return errorResponse(HTTP_STATUS.BAD_GATEWAY, "TTS credential or transport failure");
    }

    if (result.success) return result.response;

    if (result.status === 400) return result.response || errorResponse(result.status, result.error);

    if (provider === "codex" && ([400, 503, 504].includes(result.status) || signal.aborted)) return result.response || errorResponse(result.status, result.error);

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
