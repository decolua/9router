import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/constants.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*"
};

/**
 * Convert a JSON chat completion response to SSE format as a ReadableStream.
 * Used when provider returns JSON but client expects streaming.
 */
function convertJsonToSSEStream(jsonResponse) {
  const encoder = new TextEncoder();
  const choice = jsonResponse.choices?.[0];

  if (!choice) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
  }

  const message = choice.message || {};
  const content = message.content || "";
  const reasoningContent = message.reasoning_content || "";

  return new ReadableStream({
    start(controller) {
      // Send reasoning content first if present
      if (reasoningContent) {
        const chunk = `data: ${JSON.stringify({
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: jsonResponse.created || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || "unknown",
          choices: [{
            index: 0,
            delta: { reasoning_content: reasoningContent },
            finish_reason: null
          }]
        })}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }

      // Send content
      if (content) {
        const chunk = `data: ${JSON.stringify({
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: jsonResponse.created || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || "unknown",
          choices: [{
            index: 0,
            delta: { content },
            finish_reason: null
          }]
        })}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }

      // Send tool calls if present
      if (message.tool_calls) {
        const chunk = `data: ${JSON.stringify({
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: jsonResponse.created || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || "unknown",
          choices: [{
            index: 0,
            delta: { tool_calls: message.tool_calls },
            finish_reason: null
          }]
        })}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }

      // Send finish chunk with usage
      const finishChunk = `data: ${JSON.stringify({
        id: jsonResponse.id || `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: jsonResponse.created || Math.floor(Date.now() / 1000),
        model: jsonResponse.model || "unknown",
        choices: [{
          index: 0,
          delta: {},
          finish_reason: choice.finish_reason || "stop"
        }],
        usage: jsonResponse.usage || {}
      })}\n\n`;
      controller.enqueue(encoder.encode(finishChunk));

      // Send [DONE]
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
}

/**
 * Handle case: provider returns JSON but client expects SSE streaming.
 */
export async function handleJsonToSSE({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, trackDone, appendLog }) {
  trackDone();

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch (err) {
    appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
    console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) await onRequestSuccess();

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: responseBody?.choices?.[0]?.message?.content || null,
      thinking: responseBody?.choices?.[0]?.message?.reasoning_content || null,
      finish_reason: responseBody?.choices?.[0]?.finish_reason || "unknown"
    },
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  // Convert JSON to SSE format stream
  const sseStream = convertJsonToSSEStream(responseBody);
  reqLogger.logConvertedResponse({ format: "SSE", originalFormat: "JSON" });

  return {
    success: true,
    response: new Response(sseStream, { headers: SSE_HEADERS })
  };
}
