import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

const encoder = new TextEncoder();

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function normalizeClaudeUsage(usage = {}) {
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const normalized = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens
  };
  if (cacheRead > 0) normalized.cache_read_input_tokens = cacheRead;
  if (cacheCreate > 0) normalized.cache_creation_input_tokens = cacheCreate;
  return normalized;
}

function openAIJsonToClaudeJson(responseBody, model) {
  const choice = responseBody?.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];

  if (message.content) {
    content.push({ type: "text", text: String(message.content) });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      const fn = toolCall?.function || {};
      let input = {};
      if (typeof fn.arguments === "string" && fn.arguments.trim()) {
        try { input = JSON.parse(fn.arguments); } catch { input = { arguments: fn.arguments }; }
      } else if (fn.arguments && typeof fn.arguments === "object") {
        input = fn.arguments;
      }
      content.push({
        type: "tool_use",
        id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
        name: fn.name || "tool",
        input
      });
    }
  }

  const usage = responseBody?.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || usage.prompt_tokens_details?.cache_creation_tokens || 0;
  const claudeUsage = {
    input_tokens: Math.max(0, promptTokens - cacheRead - cacheCreate),
    output_tokens: completionTokens
  };
  if (cacheRead > 0) claudeUsage.cache_read_input_tokens = cacheRead;
  if (cacheCreate > 0) claudeUsage.cache_creation_input_tokens = cacheCreate;

  return {
    id: responseBody?.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: responseBody?.model || model,
    content,
    stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: claudeUsage
  };
}

function claudeJsonToSSEStream(responseBody, model) {
  return new ReadableStream({
    start(controller) {
      const id = responseBody?.id || `msg_${Date.now()}`;
      const responseModel = responseBody?.model || model;
      const usage = responseBody?.usage || {};
      const content = Array.isArray(responseBody?.content) ? responseBody.content : [];

      controller.enqueue(encoder.encode(sseEvent("message_start", {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: responseModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: usage.input_tokens || 0,
            output_tokens: 0,
            ...(usage.cache_read_input_tokens ? { cache_read_input_tokens: usage.cache_read_input_tokens } : {}),
            ...(usage.cache_creation_input_tokens ? { cache_creation_input_tokens: usage.cache_creation_input_tokens } : {})
          }
        }
      })));

      content.forEach((block, index) => {
        if (block?.type === "text") {
          controller.enqueue(encoder.encode(sseEvent("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "text", text: "" }
          })));
          if (block.text) {
            controller.enqueue(encoder.encode(sseEvent("content_block_delta", {
              type: "content_block_delta",
              index,
              delta: { type: "text_delta", text: block.text }
            })));
          }
          controller.enqueue(encoder.encode(sseEvent("content_block_stop", { type: "content_block_stop", index })));
        } else if (block?.type === "thinking") {
          controller.enqueue(encoder.encode(sseEvent("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "thinking", thinking: "", signature: block.signature || "" }
          })));
          if (block.thinking) {
            controller.enqueue(encoder.encode(sseEvent("content_block_delta", {
              type: "content_block_delta",
              index,
              delta: { type: "thinking_delta", thinking: block.thinking }
            })));
          }
          controller.enqueue(encoder.encode(sseEvent("content_block_stop", { type: "content_block_stop", index })));
        } else if (block?.type === "tool_use") {
          controller.enqueue(encoder.encode(sseEvent("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: block.id, name: block.name, input: {} }
          })));
          const inputJson = JSON.stringify(block.input || {});
          if (inputJson && inputJson !== "{}") {
            controller.enqueue(encoder.encode(sseEvent("content_block_delta", {
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: inputJson }
            })));
          }
          controller.enqueue(encoder.encode(sseEvent("content_block_stop", { type: "content_block_stop", index })));
        }
      });

      const stopReason = responseBody?.stop_reason || "end_turn";
      controller.enqueue(encoder.encode(sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: responseBody?.stop_sequence || null },
        usage: {
          output_tokens: usage.output_tokens || 0,
          ...(usage.input_tokens ? { input_tokens: usage.input_tokens } : {}),
          ...(usage.cache_read_input_tokens ? { cache_read_input_tokens: usage.cache_read_input_tokens } : {}),
          ...(usage.cache_creation_input_tokens ? { cache_creation_input_tokens: usage.cache_creation_input_tokens } : {})
        }
      })));
      controller.enqueue(encoder.encode(sseEvent("message_stop", { type: "message_stop" })));
      controller.close();
    }
  });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*"
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  const needsCodexTranslation = provider === "codex" && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    // Codex returns Responses API SSE → translate to client format
    let codexTarget;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) codexTarget = FORMATS.OPENAI_RESPONSES;
    else if (sourceFormat === FORMATS.CLAUDE) codexTarget = FORMATS.CLAUDE;
    else if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) codexTarget = FORMATS.ANTIGRAVITY;
    else codexTarget = FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, streamController, onStreamComplete }) {
  if (onRequestSuccess) onRequestSuccess();

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE" });
  };

  return { onStreamComplete, streamDetailId };
}
/**
 * Handle a non-streaming Claude JSON provider response while preserving a Claude SSE client contract.
 * Used for providers whose upstream streaming path is unstable but whose non-streaming endpoint is reliable.
 */
export async function handleClaudeJsonAsStreamingResponse({ providerResponse, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, streamController, onStreamComplete, trackDone, appendLog }) {
  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch (err) {
    streamController.handleError(err);
    appendLog?.({ status: "FAILED 502" });
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `Invalid JSON response from ${provider}` } }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      })
    };
  }

  reqLogger?.logProviderResponse?.(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) await onRequestSuccess();

  const usage = normalizeClaudeUsage(responseBody?.usage || {});
  appendLog?.({ tokens: usage, status: "200 OK" });

  const textContent = Array.isArray(responseBody?.content)
    ? responseBody.content.filter(b => b?.type === "text").map(b => b.text || "").join("")
    : "";
  const thinking = Array.isArray(responseBody?.content)
    ? responseBody.content.filter(b => b?.type === "thinking").map(b => b.thinking || "").join("")
    : null;
  onStreamComplete?.({ content: textContent, thinking }, usage, Date.now());
  trackDone?.();
  streamController.handleComplete();

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: Date.now() - requestStartTime, total: Date.now() - requestStartTime },
    tokens: usage,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: { content: textContent, thinking, type: "streaming" },
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save synthetic stream:", err.message);
  });

  return {
    success: true,
    response: new Response(claudeJsonToSSEStream(responseBody, model), { headers: SSE_HEADERS })
  };
}


/**
 * Handle a non-streaming OpenAI JSON provider response while preserving a Claude SSE client contract.
 * Used for MMF free Claude mode because its upstream SSE socket can stall after first bytes.
 */
export async function handleOpenAIJsonAsClaudeStreamingResponse({ providerResponse, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, streamController, onStreamComplete, trackDone, appendLog }) {
  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch (err) {
    streamController.handleError(err);
    appendLog?.({ status: "FAILED 502" });
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `Invalid JSON response from ${provider}` } }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      })
    };
  }

  reqLogger?.logProviderResponse?.(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) await onRequestSuccess();

  const claudeBody = openAIJsonToClaudeJson(responseBody, model);
  const usage = normalizeClaudeUsage(claudeBody.usage || {});
  appendLog?.({ tokens: usage, status: "200 OK" });

  const textContent = Array.isArray(claudeBody.content)
    ? claudeBody.content.filter(b => b?.type === "text").map(b => b.text || "").join("")
    : "";
  const thinking = null;
  onStreamComplete?.({ content: textContent, thinking }, usage, Date.now());
  trackDone?.();
  streamController.handleComplete();

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: Date.now() - requestStartTime, total: Date.now() - requestStartTime },
    tokens: usage,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: { content: textContent, thinking, type: "streaming" },
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save synthetic OpenAI stream:", err.message);
  });

  return {
    success: true,
    response: new Response(claudeJsonToSSEStream(claudeBody, model), { headers: SSE_HEADERS })
  };
}
