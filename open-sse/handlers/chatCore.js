import { detectFormat, getTargetFormat, buildProviderUrl, buildProviderHeaders } from "../services/provider.js";
import { translateRequest, needsTranslation } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger, COLORS } from "../utils/stream.js";
import { createStreamController, pipeWithDisconnect } from "../utils/streamHandler.js";
import { refreshTokenByProvider, refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { saveRequestUsage, trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";

/**
 * Extract usage from non-streaming response body
 * Handles different provider response formats
 */
function extractUsageFromResponse(responseBody, provider) {
  if (!responseBody) return null;

  // OpenAI format
  if (responseBody.usage) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined || responseBody.usage?.output_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // Gemini format
  if (responseBody.usageMetadata) {
    return {
      prompt_tokens: responseBody.usageMetadata.promptTokenCount || 0,
      completion_tokens: responseBody.usageMetadata.candidatesTokenCount || 0,
      reasoning_tokens: responseBody.usageMetadata.thoughtsTokenCount
    };
  }

  return null;
}

/**
 * Core chat handler - shared between SSE and Worker
 * Returns { success, response, status, error } for caller to handle fallback
 * @param {object} options
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} options.log - Logger instance (optional)
 * @param {function} options.onCredentialsRefreshed - Callback when credentials are refreshed
 * @param {function} options.onRequestSuccess - Callback when request succeeds (to clear error status)
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {string} options.connectionId - Connection ID for usage tracking
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId }) {
  const { provider, model } = modelInfo;

  const sourceFormat = detectFormat(body);

  // Check for bypass patterns (warmup, skip) - return fake response
  const bypassResponse = handleBypassRequest(body, model);
  if (bypassResponse) {
    return bypassResponse;
  }

  // Detect source format and get target format
  // Model-specific targetFormat takes priority over provider default

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);
  const stream = body.stream !== false;

  // Create request logger for this session: sourceFormat_targetFormat_model
  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  
  // 0. Log client raw request (before any conversion)
  if (clientRawRequest) {
    reqLogger.logClientRawRequest(
      clientRawRequest.endpoint,
      clientRawRequest.body,
      clientRawRequest.headers
    );
  }
  
  // 1. Log raw request from client
  reqLogger.logRawRequest(body);
  
  // 1a. Log format detection info
  reqLogger.logFormatInfo({
    sourceFormat,
    targetFormat,
    provider,
    model,
    stream
  });

  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Translate request
  let translatedBody = body;
  translatedBody = translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider);
  

  // Update model in body
  translatedBody.model = model;

  // Build provider URL and headers
  const providerUrl = buildProviderUrl(provider, model, stream);
  const providerHeaders = buildProviderHeaders(provider, credentials, stream, translatedBody);

  // Track pending request
  trackPendingRequest(model, provider, connectionId, true);

  // Log start
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => {});

  // 2. Log converted request to provider
  reqLogger.logConvertedRequest(providerUrl, providerHeaders, translatedBody);

  const msgCount = translatedBody.messages?.length 
    || translatedBody.contents?.length 
    || translatedBody.request?.contents?.length 
    || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);
  
  // Log headers (mask sensitive values)
  const safeHeaders = {};
  for (const [key, value] of Object.entries(providerHeaders)) {
    if (key.toLowerCase().includes("auth") || key.toLowerCase().includes("key") || key.toLowerCase().includes("token")) {
      safeHeaders[key] = value ? `${value.slice(0, 10)}...` : "";
    } else {
      safeHeaders[key] = value;
    }
  }
  log?.debug?.("HEADERS", JSON.stringify(safeHeaders));

  // Create stream controller for disconnect detection
  const streamController = createStreamController({ onDisconnect, log, provider, model });

  // Make request to provider with abort signal
  let providerResponse;
  try {
    providerResponse = await fetch(providerUrl, {
      method: "POST",
      headers: providerHeaders,
      body: JSON.stringify(translatedBody),
      signal: streamController.signal
    });
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : 502}` }).catch(() => {});
    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, 502);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(502, errMsg);
  }


  // Handle 401/403 - try token refresh
  if (providerResponse.status === 401 || providerResponse.status === 403) {
    let newCredentials = null;
    
    // GitHub needs special handling - refresh copilotToken using accessToken
    if (provider === "github") {
      const { refreshCopilotToken, refreshGitHubToken } = await import("../services/tokenRefresh.js");
      
      // First try refreshing copilotToken using existing accessToken
      let copilotResult = await refreshCopilotToken(credentials.accessToken, log);
      
      // If that fails, refresh GitHub accessToken first, then get new copilotToken
      if (!copilotResult && credentials.refreshToken) {
        const githubTokens = await refreshGitHubToken(credentials.refreshToken, log);
        if (githubTokens?.accessToken) {
          credentials.accessToken = githubTokens.accessToken;
          if (githubTokens.refreshToken) {
            credentials.refreshToken = githubTokens.refreshToken;
          }
          copilotResult = await refreshCopilotToken(githubTokens.accessToken, log);
        }
      }
      
      if (copilotResult?.token) {
        credentials.copilotToken = copilotResult.token;
        newCredentials = {
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          providerSpecificData: {
            ...credentials.providerSpecificData,
            copilotToken: copilotResult.token,
            copilotTokenExpiresAt: copilotResult.expiresAt
          }
        };
        log?.info?.("TOKEN", `${provider.toUpperCase()} | copilotToken refreshed`);
      }
    } else {
      newCredentials = await refreshWithRetry(
        () => refreshTokenByProvider(provider, credentials, log),
        3,
        log
      );
    }

    if (newCredentials?.accessToken || (provider === "github" && credentials.copilotToken)) {
      if (newCredentials?.accessToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        credentials.accessToken = newCredentials.accessToken;
      }
      if (newCredentials?.refreshToken) {
        credentials.refreshToken = newCredentials.refreshToken;
      }
      if (newCredentials?.providerSpecificData) {
        credentials.providerSpecificData = {
          ...credentials.providerSpecificData,
          ...newCredentials.providerSpecificData
        };
      }

      // Notify caller about refreshed credentials
      if (onCredentialsRefreshed && newCredentials) {
        await onCredentialsRefreshed(newCredentials);
      }

      // Retry with new credentials
      const newHeaders = buildProviderHeaders(provider, credentials, stream, translatedBody);
      const retryResponse = await fetch(providerUrl, {
        method: "POST",
        headers: newHeaders,
        body: JSON.stringify(translatedBody),
        signal: streamController.signal
      });

      if (retryResponse.ok) {
        providerResponse = retryResponse;
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  // Check provider response - return error info for fallback handling
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false);
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => {});
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    
    // Log error with full request body for debugging
    reqLogger.logError(new Error(message), translatedBody);

    return createErrorResult(statusCode, errMsg);
  }

  // Non-streaming response
  if (!stream) {
    trackPendingRequest(model, provider, connectionId, false);
    const responseBody = await providerResponse.json();

    // Notify success - caller can clear error status if needed
    if (onRequestSuccess) {
      await onRequestSuccess();
    }

    // Log usage for non-streaming responses
    const usage = extractUsageFromResponse(responseBody, provider);
    appendRequestLog({ model, provider, connectionId, tokens: usage, status: "200 OK" }).catch(() => {});
    if (usage) {
      const msg = `[${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}] 📊 [USAGE] ${provider.toUpperCase()} | in=${usage.prompt_tokens || 0} | out=${usage.completion_tokens || 0}${connectionId ? ` | account=${connectionId.slice(0, 8)}...` : ""}`;
      console.log(`${COLORS.green}${msg}${COLORS.reset}`);

      saveRequestUsage({
        provider: provider || "unknown",
        model: model || "unknown",
        tokens: usage,
        timestamp: new Date().toISOString(),
        connectionId: connectionId || undefined
      }).catch(err => {
        console.error("Failed to save usage stats:", err.message);
      });
    }

    return {
      success: true,
      response: new Response(JSON.stringify(responseBody), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      })
    };
  }

  // Streaming response
  
  // Notify success - caller can clear error status if needed
  if (onRequestSuccess) {
    await onRequestSuccess();
  }

  const responseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  };

  // Create transform stream with logger for streaming response
  let transformStream;
  if (needsTranslation(targetFormat, sourceFormat)) {
    transformStream = createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, model, connectionId);
  } else {
    transformStream = createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId);
  }

  // Pipe response through transform with disconnect detection
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController);

  return {
    success: true,
    response: new Response(transformedBody, {
      headers: responseHeaders
    })
  };
}

/**
 * Check if token is expired or about to expire
 */
export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return expiresAtMs - Date.now() < bufferMs;
}