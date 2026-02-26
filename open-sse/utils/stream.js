import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";

export { COLORS, formatSSE };

const sharedDecoder = new TextDecoder();
const sharedEncoder = new TextEncoder();

/**
 * Detect actual response format from a parsed SSE chunk.
 * Used to auto-correct when upstream returns a different format than expected
 * (e.g. anthropic-compatible endpoint that actually returns OpenAI responses,
 *  or openai-compatible endpoint that actually returns Claude SSE events).
 */
function detectResponseFormat(chunk) {
  if (!chunk) return null;

  // OpenAI Responses API format: has "type" field with "response.xxx" value
  if (chunk.type !== undefined && chunk.type.startsWith("response.")) {
    return FORMATS.OPENAI_RESPONSES;
  }

  // OpenAI chat-completion format: has "choices" array with delta
  if (chunk.choices !== undefined) {
    return FORMATS.OPENAI;
  }

  // Claude format: has "type" field (message_start, content_block_delta, etc.)
  if (chunk.type !== undefined) {
    return FORMATS.CLAUDE;
  }

  // Gemini / Antigravity format: has "candidates" array
  if (chunk.candidates !== undefined) {
    return FORMATS.GEMINI;
  }

  return null;
}

/**
 * Resolve the *effective* targetFormat for translation.
 *
 * Normally `targetFormat` (what we asked the provider for) equals the format
 * the provider actually returns.  But some "compatible" endpoints (e.g. an
 * anthropic-compatible proxy that internally uses OpenAI, or vice-versa)
 * return a *different* wire format.
 *
 * When we detect that the actual chunk format differs from `targetFormat` we
 * return the detected format so the translator pipeline picks the correct
 * converters.  The detected format is cached in `state.detectedFormat` so we
 * don't have to sniff every chunk.
 */
function resolveActualTargetFormat(parsed, targetFormat, sourceFormat, state) {
  // Fast path: if we already detected a mismatch earlier, reuse it
  if (state?.detectedFormat) return state.detectedFormat;

  const detected = detectResponseFormat(parsed);
  if (!detected) return targetFormat; // could not detect, assume config is right

  // If the detected format matches what we expected, nothing to do
  if (detected === targetFormat) return targetFormat;

  // The upstream is sending a different format than configured.
  // Store in state so subsequent chunks & flush reuse the same decision.
  if (state) state.detectedFormat = detected;
  return detected;
}

function normalizeProviderStreamChunk(parsed, state) {
  if (!parsed || typeof parsed !== "object") return null;

  // Already OpenAI-style chunk
  if (Array.isArray(parsed.choices)) return parsed;

  // Ollama NDJSON stream chunk -> OpenAI chat.completion.chunk
  if (parsed.message && typeof parsed.message === "object") {
    const message = parsed.message;
    const content = typeof message.content === "string" ? message.content : "";
    const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    const toolCalls = rawToolCalls.map((tc, idx) => {
      const fn = tc?.function || {};
      const args = fn.arguments;
      return {
        index: idx,
        id: tc?.id || `call_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: fn.name || "unknown_tool",
          arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
        },
      };
    });

    const delta = {};
    if (content) delta.content = content;
    if (toolCalls.length > 0) delta.tool_calls = toolCalls;

    const usage =
      typeof parsed.prompt_eval_count === "number" || typeof parsed.eval_count === "number"
        ? {
          prompt_tokens: parsed.prompt_eval_count || 0,
          completion_tokens: parsed.eval_count || 0,
          total_tokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
        }
        : undefined;

    const finishReason = parsed.done
      ? (toolCalls.length > 0 ? "tool_calls" : "stop")
      : null;

    return {
      id: parsed.id || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: parsed.model || state?.model || "unknown",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
  }

  return parsed;
}

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate",    // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
};

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null
  } = options;

  let buffer = "";
  let usage = null;

  const state = mode === STREAM_MODE.TRANSLATE ? { ...initState(sourceFormat), provider, toolNameMap, model } : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) {
        ttftAt = Date.now();
      }
      const text = sharedDecoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
                if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
              }

              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                }
              }

              if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              const reasoning = delta?.reasoning_content;
              if (content && typeof content === "string") {
                totalContentLength += content.length;
                accumulatedContent += content;
              }
              if (reasoning && typeof reasoning === "string") {
                totalContentLength += reasoning.length;
                accumulatedThinking += reasoning;
              }

              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = extracted;
              }

              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                usage = estimated;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch { }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        const parsed = parseSSELine(trimmed);
        if (!parsed) continue;

        const normalizedParsed = normalizeProviderStreamChunk(parsed, state);
        if (!normalizedParsed) continue;

        if (normalizedParsed.done) {
          if (sourceFormat !== FORMATS.CLAUDE) {
            const output = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
          continue;
        }

        // Claude format - content
        if (normalizedParsed.delta?.text) {
          totalContentLength += normalizedParsed.delta.text.length;
          accumulatedContent += normalizedParsed.delta.text;
        }
        // Claude format - thinking
        if (normalizedParsed.delta?.thinking) {
          totalContentLength += normalizedParsed.delta.thinking.length;
          accumulatedThinking += normalizedParsed.delta.thinking;
        }

        // OpenAI format - content
        if (normalizedParsed.choices?.[0]?.delta?.content) {
          totalContentLength += normalizedParsed.choices[0].delta.content.length;
          accumulatedContent += normalizedParsed.choices[0].delta.content;
        }
        // OpenAI format - reasoning
        if (normalizedParsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += normalizedParsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += normalizedParsed.choices[0].delta.reasoning_content;
        }

        // Gemini format
        if (normalizedParsed.candidates?.[0]?.content?.parts) {
          for (const part of normalizedParsed.candidates[0].content.parts) {
            if (part.text && typeof part.text === "string") {
              totalContentLength += part.text.length;
              // Check if this is thinking content
              if (part.thought === true) {
                accumulatedThinking += part.text;
              } else {
                accumulatedContent += part.text;
              }
            }
          }
        }

        // Extract usage
        const extracted = extractUsage(normalizedParsed);
        if (extracted) state.usage = extracted; // Keep original usage for logging

        // Resolve actual upstream format – auto-detects mismatches between
        // the configured targetFormat and what the provider really returns
        const actualTargetFormat = resolveActualTargetFormat(normalizedParsed, targetFormat, sourceFormat, state);

        // Translate: actualTargetFormat -> openai -> sourceFormat
        const translated = translateResponse(actualTargetFormat, sourceFormat, normalizedParsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = estimateUsage(body, totalContentLength, sourceFormat);
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
              state.usage = estimated;
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
        }
      }
    },

    flush(controller) {
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = sharedDecoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }

          if (!hasValidUsage(usage) && totalContentLength > 0) {
            usage = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
          }

          if (hasValidUsage(usage)) {
            logUsage(provider, usage, model, connectionId, apiKey);
          } else {
            appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
          }

          // IMPORTANT: In passthrough mode we still must terminate the SSE stream.
          // Some clients (e.g. OpenClaw) expect the OpenAI-style sentinel:
          //   data: [DONE]\n\n
          // Without it they can hang until timeout and trigger failover.
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));

          if (onStreamComplete) {
            onStreamComplete({
              content: accumulatedContent,
              thinking: accumulatedThinking
            }, usage, ttftAt);
          }
          return;
        }

        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const normalizedParsed = normalizeProviderStreamChunk(parsed, state);
            if (!normalizedParsed) return;

            const actualTargetFormat = resolveActualTargetFormat(normalizedParsed, targetFormat, sourceFormat, state);
            const translated = translateResponse(actualTargetFormat, sourceFormat, normalizedParsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                controller.enqueue(sharedEncoder.encode(output));
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        const doneOutput = "data: [DONE]\n\n";
        reqLogger?.appendConvertedChunk?.(doneOutput);
        controller.enqueue(sharedEncoder.encode(doneOutput));

        if (!hasValidUsage(state?.usage) && totalContentLength > 0) {
          state.usage = estimateUsage(body, totalContentLength, sourceFormat);
        }

        if (hasValidUsage(state?.usage)) {
          logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
        } else {
          appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
        }

        if (onStreamComplete) {
          onStreamComplete({
            content: accumulatedContent,
            thinking: accumulatedThinking
          }, state?.usage, ttftAt);
        }
      } catch (error) {
        console.log("Error in flush:", error);
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}
