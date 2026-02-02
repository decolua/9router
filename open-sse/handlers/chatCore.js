import { detectFormat, getTargetFormat } from "../services/provider.js";
import { translateRequest, needsTranslation } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger, COLORS } from "../utils/stream.js";
import { createStreamController, pipeWithDisconnect } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { saveRequestUsage, trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";

/**
 * Translate non-streaming response to OpenAI format
 * Handles different provider response formats (Gemini, Claude, etc.)
 */
function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat) {
  // If already in source format (usually OpenAI), return as-is
  if (targetFormat === sourceFormat || targetFormat === FORMATS.OPENAI) {
    return responseBody;
  }

  // Handle Gemini/Antigravity format
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) {
      return responseBody; // Can't translate, return raw
    }

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;

    // Build message content
    let textContent = "";
    const toolCalls = [];
    let reasoningContent = "";

    if (content?.parts) {
      for (const part of content.parts) {
        // Handle thinking/reasoning
        if (part.thought === true && part.text) {
          reasoningContent += part.text;
        }
        // Regular text
        else if (part.text !== undefined) {
          textContent += part.text;
        }
        // Function calls
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          });
        }
      }
    }

    // Build OpenAI format message
    const message = { role: "assistant" };
    if (textContent) {
      message.content = textContent;
    }
    if (reasoningContent) {
      message.reasoning_content = reasoningContent;
    }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    // If no content at all, set content to empty string
    if (!message.content && !message.tool_calls) {
      message.content = "";
    }

    // Determine finish reason
    let finishReason = (candidate.finishReason || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) {
      finishReason = "tool_calls";
    }

    const result = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason
      }]
    };

    // Add usage if available (match streaming translator: add thoughtsTokenCount to prompt_tokens)
    if (usage) {
      result.usage = {
        prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
      if (usage.thoughtsTokenCount > 0) {
        result.usage.completion_tokens_details = {
          reasoning_tokens: usage.thoughtsTokenCount
        };
      }
    }

    return result;
  }

  // Handle Claude format
  if (targetFormat === FORMATS.CLAUDE) {
    if (!responseBody.content) {
      return responseBody; // Can't translate, return raw
    }

    let textContent = "";
    let thinkingContent = "";
    const toolCalls = [];

    for (const block of responseBody.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "thinking") {
        thinkingContent += block.thinking || "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {})
          }
        });
      }
    }

    const message = { role: "assistant" };
    if (textContent) {
      message.content = textContent;
    }
    if (thinkingContent) {
      message.reasoning_content = thinkingContent;
    }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    if (!message.content && !message.tool_calls) {
      message.content = "";
    }

    let finishReason = responseBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason
      }]
    };

    if (responseBody.usage) {
      result.usage = {
        prompt_tokens: responseBody.usage.input_tokens || 0,
        completion_tokens: responseBody.usage.output_tokens || 0,
        total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0)
      };
    }

    return result;
  }

  // Unknown format, return as-is
  return responseBody;
}

/**
 * Extract usage from non-streaming response body
 * Handles different provider response formats
 */
function extractUsageFromResponse(responseBody, provider) {
  if (!responseBody || typeof responseBody !== 'object') return null;

  // OpenAI format
  if (responseBody.usage && typeof responseBody.usage === 'object') {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Claude format
  if (responseBody.usage && typeof responseBody.usage === 'object' && (responseBody.usage.input_tokens !== undefined || responseBody.usage.output_tokens !== undefined)) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // Gemini format
  if (responseBody.usageMetadata && typeof responseBody.usageMetadata === 'object') {
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
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent }) {
  const { provider, model } = modelInfo;

  const sourceFormat = detectFormat(body);

  // Check for bypass patterns (warmup, skip) - return fake response
  const bypassResponse = handleBypassRequest(body, model, userAgent);
  if (bypassResponse) {
    return bypassResponse;
  }

  // Detect source format and get target format
  // Model-specific targetFormat takes priority over provider default

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);

  // Force streaming for OpenAI/Codex models (they don't support non-streaming mode properly)
  const stream = (provider === 'openai' || provider === 'codex') ? true : (body.stream !== false);

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

  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Translate request (pass reqLogger for intermediate logging)
  let translatedBody = body;
  translatedBody = translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider, reqLogger);

  // Extract toolNameMap for response translation (Claude OAuth)
  const toolNameMap = translatedBody._toolNameMap;
  delete translatedBody._toolNameMap;

  // Update model in body
  translatedBody.model = model;

  // Get executor for this provider
  const executor = getExecutor(provider);

  // Track pending request
  trackPendingRequest(model, provider, connectionId, true);

  // Log start
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length
    || translatedBody.contents?.length
    || translatedBody.request?.contents?.length
    || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  // Create stream controller for disconnect detection
  const streamController = createStreamController({ onDisconnect, log, provider, model });

  // Execute request using executor (handles URL building, headers, fallback, transform)
  let providerResponse;
  let providerUrl;
  let providerHeaders;
  let finalBody;

  try {
    const result = await executor.execute({
      model,
      body: translatedBody,
      stream,
      credentials,
      signal: streamController.signal,
      log
    });

    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;

    // Log target request (final request to provider)
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);

  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : 502}` }).catch(() => { });
    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, 502);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(502, errMsg);
  }

  // Handle 401/403 - try token refresh using executor
  if (providerResponse.status === 401 || providerResponse.status === 403) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.copilotToken) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);

      // Update credentials
      Object.assign(credentials, newCredentials);

      // Notify caller about refreshed credentials
      if (onCredentialsRefreshed && newCredentials) {
        await onCredentialsRefreshed(newCredentials);
      }

      // Retry with new credentials
      try {
        const retryResult = await executor.execute({
          model,
          body: translatedBody,
          stream,
          credentials,
          signal: streamController.signal,
          log
        });

        if (retryResult.response.ok) {
          providerResponse = retryResult.response;
          providerUrl = retryResult.url;
        }
      } catch (retryError) {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  // Check provider response - return error info for fallback handling
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false);
    const { statusCode, message, retryAfterMs } = await parseUpstreamError(providerResponse, provider);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);

    // Log Antigravity retry time if available
    if (retryAfterMs && provider === "antigravity") {
      const retrySeconds = Math.ceil(retryAfterMs / 1000);
      log?.debug?.("RETRY", `Antigravity quota reset in ${retrySeconds}s (${retryAfterMs}ms)`);
    }

    // Log error with full request body for debugging
    reqLogger.logError(new Error(message), finalBody || translatedBody);

    return createErrorResult(statusCode, errMsg, retryAfterMs);
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
    appendRequestLog({ model, provider, connectionId, tokens: usage, status: "200 OK" }).catch(() => { });
    if (usage && typeof usage === 'object') {
      const msg = `[${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}] 📊 [USAGE] ${provider.toUpperCase()} | in=${usage?.prompt_tokens || 0} | out=${usage?.completion_tokens || 0}${connectionId ? ` | account=${connectionId.slice(0, 8)}...` : ""}`;
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

    // Translate response to client's expected format (usually OpenAI)
    const translatedResponse = needsTranslation(targetFormat, sourceFormat)
      ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
      : responseBody;

    return {
      success: true,
      response: new Response(JSON.stringify(translatedResponse), {
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
  // For Codex provider, always translate response from openai-responses to openai format
  // This ensures clients like Cursor get the expected chat completions format
  const needsCodexTranslation = (provider === 'codex' || provider === 'openai') && targetFormat === 'openai-responses';
  if (needsCodexTranslation || needsTranslation(targetFormat, sourceFormat)) {
    // For Codex, translate FROM openai-responses TO openai (client's expected format)
    const responseSourceFormat = needsCodexTranslation ? 'openai-responses' : targetFormat;
    const responseTargetFormat = needsCodexTranslation ? 'openai' : sourceFormat;
    transformStream = createSSETransformStreamWithLogger(responseSourceFormat, responseTargetFormat, provider, reqLogger, toolNameMap, model, connectionId);
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