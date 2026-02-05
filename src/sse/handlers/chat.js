import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { handleComboChat } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";

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
    return errorResponse(400, "Invalid JSON body");
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
  const apiKey = request.headers.get("Authorization");
  if (apiKey) {
    const masked = log.maskKey(apiKey.replace("Bearer ", ""));
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(400, "Missing model");
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(400, "Invalid model format");
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

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionId);
    if (!credentials) {
      if (!excludeConnectionId) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(400, `No credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return new Response(
        JSON.stringify({ error: lastError || "All accounts unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // Log account selection
    const accountId = credentials.connectionId.slice(0, 8);
    log.info("AUTH", `Using ${provider} account: ${accountId}...`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    
    // Use shared chatCore
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        // Clear error status only if currently has error (optimization)
        await clearAccountError(credentials.connectionId, credentials);
      }
    });
    
    if (result.success) return result.response;

    // Check if should fallback to next account
    const { shouldFallback, cooldownMs } = checkFallbackError(result.status, result.error);
    
    if (shouldFallback) {
      const accountId = credentials.connectionId.slice(0, 8);
      log.warn("AUTH", `Account ${accountId}... unavailable (status: ${result.status}), trying fallback`);
      await markAccountUnavailable(credentials.connectionId, cooldownMs, result.error?.slice(0, 100), result.status, provider);
      excludeConnectionId = credentials.connectionId;
      lastError = result.error;
      continue;
    }

    return result.response;
  }
}
