import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { reportMalformed200, synthClaudeErrorEvents, synthOpenAIErrorChunk, synthResponsesFailure } from "./diagnostics.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";

// Responses-API event names that carry actual client output (content/tool args).
// Used to decide whether a passthrough stream "produced output" for empty-detection.
const RESPONSES_OUTPUT_EVENTS = new Set([
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_item.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
]);

function hasUsableResponsesItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type && item.type !== "message") return true;
  if (!Array.isArray(item.content)) return false;
  return item.content.some((part) => {
    if (typeof part?.text === "string" && part.text.length > 0) return true;
    if (part?.type === "output_text" && typeof part.text === "string" && part.text.length > 0) return true;
    return false;
  });
}

function hasUsableResponsesOutput(output) {
  return Array.isArray(output) && output.some(hasUsableResponsesItem);
}

function markResponsesOutput(eventName, parsed) {
  if (eventName === "response.output_text.delta") {
    return typeof parsed?.delta === "string" && parsed.delta.length > 0;
  }
  if (eventName === "response.output_text.done") {
    return typeof parsed?.text === "string" && parsed.text.length > 0;
  }
  if (eventName === "response.output_item.done") {
    return hasUsableResponsesItem(parsed?.item);
  }
  if (eventName === "response.function_call_arguments.delta") {
    return typeof parsed?.delta === "string" && parsed.delta.length > 0;
  }
  if (eventName === "response.function_call_arguments.done") {
    return typeof parsed?.arguments === "string"
      ? parsed.arguments.length > 0
      : Boolean(parsed?.arguments || parsed?.name || parsed?.call_id || parsed?.item);
  }
  if (eventName === "response.completed") {
    return hasUsableResponsesOutput(parsed?.response?.output);
  }
  return RESPONSES_OUTPUT_EVENTS.has(eventName);
}


export { COLORS, formatSSE };
export { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

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
    apiKey = null,
    getAbortReason = null
  } = options;

  let buffer = "";
  let usage = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE ? { ...initState(sourceFormat), provider, toolNameMap, model } : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let totalDecodedLen = 0;     // raw upstream bytes (decoded length) for diagnostics
  let sawToolCalls = false;    // tool-call deltas emitted (content can be 0 for tool-only responses)
  let sawResponsesContent = false; // Responses passthrough carried actual output
  let ttftAt = null;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};
  const requestStart = Date.now();

  // Did this stream produce any output the client can use (text/reasoning/tool/Responses output)?
  // Used in flush() to detect the empty/malformed HTTP-200 case.
  // `sseEmittedCount > 0` guards translators whose parsed shape isn't covered by the
  // accumulators above (e.g. openai-responses → claude); if we emitted valuable chunks,
  // the stream is not empty regardless of accumulator state.
  const producedOutput = () => totalContentLength > 0 || sawToolCalls || sawResponsesContent || sseEmittedCount > 0;

  // Emit one structured [MALFORMED-200] line + return the client-shaped error SSE text.
  const emitEmptyDiagnostics = (reasonOverride) => {
    const reason = reasonOverride || getAbortReason?.() || "empty";
    reportMalformed200({
      mode: "stream", provider, model, connectionId, reason,
      recvBytes: totalDecodedLen, recvLines: sseLineCount, emitted: sseEmittedCount,
      events: eventTypeCounts,
      ttftMs: ttftAt ? ttftAt - requestStart : -1,
      elapsedMs: Date.now() - requestStart,
    });
    return reason;
  };

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let emptyDiagnosticEmitted = false;

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      totalDecodedLen += text.length;
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
          if (isDebugEnabled) { /* counters are intentionally always-on for diagnostics */ }
        }

        // Capture Responses API event name so we can preserve framing and detect
        // whether a Responses client actually received usable output.
        if (sourceFormat === FORMATS.OPENAI_RESPONSES && trimmed.startsWith("event:")) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

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

              // Filter by the client-facing format, not a hard-coded OpenAI shape.
              // Passthrough preserves the provider's native format, which may be Claude
              // (e.g. GLM) — checking OpenAI here would drop every Claude chunk and
              // starve the client (the GLM empty-stream bug).
              if (!hasValuableContent(parsed, sourceFormat)) {
                continue;
              }
              sseEmittedCount++;

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
              if (delta?.tool_calls) sawToolCalls = true;

              if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
                const eventName = getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed);
                if (markResponsesOutput(eventName, parsed)) {
                  sawResponsesContent = true;
                }
                currentOpenAIResponsesEvent = null;
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

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;

        // Responses API same-format passthrough: preserve event framing + track terminal state
        const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
        const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
        const openAIResponsesEventName = isOpenAIResponsesStream
          ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed)
          : null;

        if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
          openAIResponsesTerminalSeen = true;
        }
        // Detect real output for any Responses client (sourceFormat), not only same-format passthrough.
        if (sourceFormat === FORMATS.OPENAI_RESPONSES && markResponsesOutput(openAIResponsesEventName, parsed)) {
          sawResponsesContent = true;
        }

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          // Synthesize response.failed if the Responses stream never sent a terminal event
          if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            reqLogger?.appendConvertedChunk?.(failedOutput);
            controller.enqueue(sharedEncoder.encode(failedOutput));
            openAIResponsesTerminalSeen = true;
            sseEmittedCount++;
          }

          const output = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          continue;
        }

        // Claude format - content
        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          accumulatedContent += parsed.delta.text;
        }
        // Claude format - thinking
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          accumulatedThinking += parsed.delta.thinking;
        }
        
        // OpenAI format - content
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          accumulatedContent += parsed.choices[0].delta.content;
        }
        // OpenAI format - reasoning
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += parsed.choices[0].delta.reasoning_content;
        }
        // OpenAI format - tool calls (content can be 0 for tool-only responses)
        if (parsed.choices?.[0]?.delta?.tool_calls) sawToolCalls = true;
        // Claude format - tool_use blocks
        if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") sawToolCalls = true;
        if (parsed.delta?.partial_json) sawToolCalls = true;
        
        // Gemini format
        if (parsed.candidates?.[0]?.content?.parts) {
          for (const part of parsed.candidates[0].content.parts) {
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
        const extracted = extractUsage(parsed);
        if (extracted) state.usage = extracted; // Keep original usage for logging

        // Responses same-format passthrough: re-emit with original event framing
        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          const output = formatSSE({ event: openAIResponsesEventName, data: parsed }, sourceFormat);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          continue;
        }

        currentOpenAIResponsesEvent = null;

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
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
            sseEmittedCount++;
          }
        }
      }
    },

    flush(controller) {
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          // Mark a final buffered Responses line (upstream closed without trailing newline)
          // so flush doesn't wrongly append a synthetic response.failed after valid output.
          if (sourceFormat === FORMATS.OPENAI_RESPONSES && buffer.trim().startsWith("data:")) {
            try {
              const parsed = JSON.parse(buffer.trim().slice(5).trim());
              const eventName = getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed);
              if (markResponsesOutput(eventName, parsed)) sawResponsesContent = true;
            } catch { /* leave buffer handling intact */ }
            currentOpenAIResponsesEvent = null;
          }

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
          
          // Empty passthrough streams are valid HTTP but malformed for OpenAI clients.
          // Surface one client-shaped error chunk before [DONE] so callers get a useful cause.
          if (!emptyDiagnosticEmitted && !producedOutput()) {
            emptyDiagnosticEmitted = true;
            const reason = emitEmptyDiagnostics();
            const emptyOutput = sourceFormat === FORMATS.OPENAI_RESPONSES
              ? synthResponsesFailure(reason)
              : sourceFormat === FORMATS.CLAUDE
                ? synthClaudeErrorEvents({ provider, model, reason })
                : synthOpenAIErrorChunk({ provider, model, reason });
            reqLogger?.appendConvertedChunk?.(emptyOutput);
            controller.enqueue(sharedEncoder.encode(emptyOutput));
            sseEmittedCount++;
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
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                if (item === null || item === undefined) continue;
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
            if (item === null || item === undefined) continue;
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        // Empty/aborted stream: no content, tool calls, or Responses output was produced.
        // Emit one client-shaped error (chat chunk or Responses response.failed) before [DONE].
        const wantsResponses = sourceFormat === FORMATS.OPENAI_RESPONSES;
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (!emptyDiagnosticEmitted && !producedOutput()) {
          emptyDiagnosticEmitted = true;
          const reason = emitEmptyDiagnostics(openAIResponsesTerminalSeen ? "empty" : "no_terminal");
          const emptyOutput = wantsResponses
            ? synthResponsesFailure(reason)
            : sourceFormat === FORMATS.CLAUDE
              ? synthClaudeErrorEvents({ provider, model, reason })
              : synthOpenAIErrorChunk({ provider, model, reason });
          reqLogger?.appendConvertedChunk?.(emptyOutput);
          controller.enqueue(sharedEncoder.encode(emptyOutput));
          sseEmittedCount++;
          openAIResponsesTerminalSeen = true;
        } else if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          // Content was delivered but the stream closed without response.completed — close it cleanly.
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        if (!keepsOpenAIResponsesFormat || !openAIResponsesDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
        }

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

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, streamController = null) {
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
    apiKey,
    getAbortReason: streamController?.getAbortReason,
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, streamController = null, sourceFormat = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    sourceFormat,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    getAbortReason: streamController?.getAbortReason,
  });
}
