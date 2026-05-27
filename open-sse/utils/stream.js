import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import {
  extractUsage,
  hasValidUsage,
  estimateUsage,
  logUsage,
  addBufferToUsage,
  filterUsageForFormat,
  COLORS,
} from "./usageTracking.js";
import {
  parseSSELine,
  hasValuableContent,
  fixInvalidId,
  formatSSE,
} from "./streamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import * as log from "../../src/sse/utils/logger.js";

export { COLORS, formatSSE };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate", // Full translation between formats
  PASSTHROUGH: "passthrough", // No translation, normalize output, extract usage
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
    streamStateTracker = null,
  } = options;

  let buffer = "";
  let usage = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state =
    mode === STREAM_MODE.TRANSLATE
      ? { ...initState(sourceFormat), provider, toolNameMap, model }
      : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let firstRawChunkLogged = false;
  let firstEmittedChunkAt = null;
  let firstEmittedChunkBytes = 0;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};
  const streamStartAt = Date.now();
  const emitFirstChunkLog = (output, meta = {}) => {
    if (firstEmittedChunkAt) return;
    firstEmittedChunkAt = Date.now();
    firstEmittedChunkBytes = new TextEncoder().encode(output || "").byteLength;
    log.info(
      "SSE-FIRST",
      `${provider || "unknown"}/${model || "unknown"} | mode=${mode} | firstEmitMs=${firstEmittedChunkAt - streamStartAt}ms | bytes=${firstEmittedChunkBytes}${meta.kind ? ` | kind=${meta.kind}` : ""}`,
    );
  };
  const rawChunkEncoder = new TextEncoder();

  const updateTracker = () => {
    if (streamStateTracker) {
      streamStateTracker.accumulatedContent = accumulatedContent;
      streamStateTracker.accumulatedThinking = accumulatedThinking;
      streamStateTracker.totalContentLength = totalContentLength;
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      if (!firstRawChunkLogged) {
        firstRawChunkLogged = true;
        log.info(
          "SSE-FIRST",
          `${provider || "unknown"}/${model || "unknown"} | mode=${mode} | firstRawMs=${Date.now() - streamStartAt}ms | bytes=${rawChunkEncoder.encode(text).byteLength}`,
        );
      }
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;

          if (
            trimmed.startsWith("data:") &&
            trimmed.slice(5).trim() !== "[DONE]"
          ) {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) {
                  parsed.object = "chat.completion.chunk";
                  fieldsInjected = true;
                }
                if (!parsed.created) {
                  parsed.created = Math.floor(Date.now() / 1000);
                  fieldsInjected = true;
                }
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
                const estimated = estimateUsage(
                  body,
                  totalContentLength,
                  FORMATS.OPENAI,
                );
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
            } catch {}
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

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          const output = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
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
          totalContentLength +=
            parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += parsed.choices[0].delta.reasoning_content;
        }

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

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(
          targetFormat,
          sourceFormat,
          parsed,
          state,
        );

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
            const isFinishChunk =
              item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (
              state.finishReason &&
              isFinishChunk &&
              !hasValidUsage(item.usage) &&
              totalContentLength > 0
            ) {
              const estimated = estimateUsage(
                body,
                totalContentLength,
                sourceFormat,
              );
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
              state.usage = estimated;
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            emitFirstChunkLog(output, { kind: item.type || "translated" });
            controller.enqueue(sharedEncoder.encode(output));
            sseEmittedCount++;
          }
        }
      }
      updateTracker();
    },

    flush(controller) {
      const evtSummary =
        Object.entries(eventTypeCounts)
          .map(([k, v]) => `${k}=${v}`)
          .join(",") || "none";
      dbg(
        "SSE",
        `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`,
      );
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
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

          // IMPORTANT: Enqueue [DONE] sentinel FIRST — before any heavy logging.
          // Clients (e.g. OpenClaw) can hang without it.
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));

          // Defer heavy operations (usage estimation, DB writes) to next tick
          // so the stream closes immediately for the client.
          const _usage = usage;
          const _body = body;
          const _totalContentLength = totalContentLength;
          const _accumulatedContent = accumulatedContent;
          const _accumulatedThinking = accumulatedThinking;
          const _ttftAt = ttftAt;
          setImmediate(() => {
            let finalUsage = _usage;
            if (!hasValidUsage(finalUsage) && _totalContentLength > 0) {
              finalUsage = estimateUsage(
                _body,
                _totalContentLength,
                FORMATS.OPENAI,
              );
            }
            if (hasValidUsage(finalUsage)) {
              logUsage(provider, finalUsage, model, connectionId, apiKey);
            } else {
              appendRequestLog({
                model,
                provider,
                connectionId,
                tokens: null,
                status: "200 OK",
              }).catch(() => {});
            }
            if (onStreamComplete) {
              onStreamComplete(
                {
                  content: _accumulatedContent,
                  thinking: _accumulatedThinking,
                },
                finalUsage,
                _ttftAt,
              );
            }
          });
          return;
        }

        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const translated = translateResponse(
              targetFormat,
              sourceFormat,
              parsed,
              state,
            );

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
                emitFirstChunkLog(output, { kind: item.type || "flush-translated" });
                controller.enqueue(sharedEncoder.encode(output));
              }
            }
          }
        }

        const flushed = translateResponse(
          targetFormat,
          sourceFormat,
          null,
          state,
        );

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
            emitFirstChunkLog(output, { kind: item.type || "tail-translated" });
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        // Enqueue [DONE] sentinel before deferring heavy work
        const doneOutput = "data: [DONE]\n\n";
        reqLogger?.appendConvertedChunk?.(doneOutput);
        controller.enqueue(sharedEncoder.encode(doneOutput));

        // Defer heavy operations (usage estimation, DB writes) to next tick
        const _state = state;
        const _body = body;
        const _totalContentLength = totalContentLength;
        const _accumulatedContent = accumulatedContent;
        const _accumulatedThinking = accumulatedThinking;
        const _ttftAt = ttftAt;
        setImmediate(() => {
          if (!hasValidUsage(_state?.usage) && _totalContentLength > 0) {
            _state.usage = estimateUsage(
              _body,
              _totalContentLength,
              sourceFormat,
            );
          }
          if (hasValidUsage(_state?.usage)) {
            logUsage(
              _state.provider || targetFormat,
              _state.usage,
              model,
              connectionId,
              apiKey,
            );
          } else {
            appendRequestLog({
              model,
              provider,
              connectionId,
              tokens: null,
              status: "200 OK",
            }).catch(() => {});
          }
          if (onStreamComplete) {
            onStreamComplete(
              { content: _accumulatedContent, thinking: _accumulatedThinking },
              _state?.usage,
              _ttftAt,
            );
          }
        });
      } catch (error) {
        console.log("Error in flush:", error);
      }
    },
  });
}

export function createSSETransformStreamWithLogger(
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
  streamStateTracker = null,
) {
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
    streamStateTracker,
  });
}

export function createPassthroughStreamWithLogger(
  provider = null,
  reqLogger = null,
  model = null,
  connectionId = null,
  body = null,
  onStreamComplete = null,
  apiKey = null,
  streamStateTracker = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    streamStateTracker,
  });
}
