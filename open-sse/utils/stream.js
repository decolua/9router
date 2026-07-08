import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { sanitizeToolArgs } from "../translator/concerns/toolArgSanitizer.js";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";

export { COLORS, formatSSE };
export { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

// Claude passthrough tool_use arg sanitizer state (per-stream).
// Buffers input_json_delta fragments per tool_use id; at content_block_stop,
// sanitizes and re-emits a single consolidated content_block_delta.
function createPassthroughToolState() {
  // Map: contentBlockIndex → { id, name, fragments: string[] }
  const toolBlocks = new Map();
  // Map: toolUseId → contentBlockIndex (for matching deltas by index)
  const indexToId = new Map();
  return {
    toolBlocks,
    indexToId,
  };
}

/**
 * Process a parsed claude chunk in passthrough mode for tool_use sanitization.
 * Returns null if no sanitization action needed (chunk should pass through as-is),
 * or an array of replacement chunks to emit instead.
 */
function processClaudePassthroughToolUse(parsed, state) {
  if (!parsed || typeof parsed !== "object") return null;

  // content_block_start with tool_use: register a new tool block buffer
  if (parsed.type === "content_block_start" && parsed.content_block?.type === CLAUDE_BLOCK.TOOL_USE) {
    const idx = parsed.index;
    const toolId = parsed.content_block.id;
    const toolName = parsed.content_block.name;
    state.toolBlocks.set(idx, { id: toolId, name: toolName, fragments: [] });
    state.indexToId.set(toolId, idx);
    return null; // pass through as-is
  }

  // content_block_delta with input_json_delta: buffer fragment, suppress emission
  if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
    const idx = parsed.index;
    const block = state.toolBlocks.get(idx);
    if (block) {
      block.fragments.push(parsed.delta.partial_json);
      return []; // suppress — we'll re-emit consolidated at content_block_stop
    }
    return null; // not a tracked tool block, pass through
  }

  // content_block_stop for a tracked tool_use: sanitize + re-emit consolidated delta
  if (parsed.type === "content_block_stop") {
    const idx = parsed.index;
    const block = state.toolBlocks.get(idx);
    if (block) {
      state.toolBlocks.delete(idx);
      state.indexToId.delete(block.id);
      const rawArgs = block.fragments.join("");
      const sanitized = sanitizeToolArgs(block.name, rawArgs);
      // Always emit a single consolidated delta (sanitized or unchanged) + stop.
      // The original fragments were suppressed; re-emit one consolidated delta here.
      const consolidatedDelta = {
        type: "content_block_delta",
        index: idx,
        delta: { type: "input_json_delta", partial_json: sanitized },
      };
      return [consolidatedDelta, parsed];
    }
    return null;
  }

  return null;
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

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE ? { ...initState(sourceFormat), provider, toolNameMap, model } : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false;  // track duplicate [DONE] across transform + flush

  // Claude identity passthrough tool_use arg sanitizer state.
  // Only active when sourceFormat === FORMATS.CLAUDE (claude↔ollama direct transport).
  // Buffers input_json_delta fragments per tool_use content block; at
  // content_block_stop, sanitizes args and re-emits a single consolidated delta.
  const passthroughToolState = (mode === STREAM_MODE.PASSTHROUGH && sourceFormat === FORMATS.CLAUDE)
    ? createPassthroughToolState()
    : null;
  // [diag:ollama-passthrough] confirm claude identity passthrough transport is
  // active for this stream (claude client ↔ claude-format upstream, e.g. ollama
  // /v1/messages). Remove after validation.
  if (passthroughToolState) {
    console.log("[ollama-passthrough] active provider=" + provider + " model=" + model);
  }

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
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

        // Capture Responses API event name to preserve framing in same-format passthrough
        if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES && trimmed.startsWith("event:")) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;

          // Claude identity passthrough: sanitize tool_use args (AskUserQuestion,
          // Read, etc.) before the OpenAI-specific hasValuableContent check below
          // (claude chunks have no `choices` field and would be dropped).
          // Buffers input_json_delta per tool_use id; at content_block_stop,
          // sanitizes and re-emits a single consolidated delta.
          if (passthroughToolState && trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());
              const replacement = processClaudePassthroughToolUse(parsed, passthroughToolState);
              if (replacement === null) {
                // Not a tool_use-related chunk, or content_block_start that we track
                // but pass through. If it's a claude chunk (has .type), emit it
                // directly to bypass the OpenAI-specific hasValuableContent check.
                if (parsed && typeof parsed === "object" && parsed.type && !parsed.choices) {
                  output = `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`;
                  reqLogger?.appendConvertedChunk?.(output);
                  controller.enqueue(sharedEncoder.encode(output));
                  continue;
                }
                // Otherwise fall through to OpenAI passthrough logic below.
              } else if (Array.isArray(replacement) && replacement.length === 0) {
                // input_json_delta fragment for a tracked tool_use — suppress emission.
                // Will re-emit consolidated sanitized delta at content_block_stop.
                continue;
              } else if (Array.isArray(replacement) && replacement.length > 0) {
                // content_block_stop for a tracked tool_use: emit sanitized delta(s)
                // + the stop event, then skip the rest of passthrough processing.
                for (const ev of replacement) {
                  const out = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
                  reqLogger?.appendConvertedChunk?.(out);
                  controller.enqueue(sharedEncoder.encode(out));
                }
                continue;
              }
            } catch {
              // Non-JSON data line — fall through to normal passthrough emission
            }
          }

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

              // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
              // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
              // every streaming delta. @ai-sdk/openai-compatible checks
              // `delta.tool_calls != null` — an empty array passes this check,
              // causing premature `reasoning-end` on every chunk.
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
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
                usage = mergeUsage(usage, extracted);
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
            } catch {
              // Skip non-JSON data lines silently — don't forward garbage to clients.
              // Upstream providers sometimes return plain-text errors (HTML, rate-limit
              // messages) in the SSE stream that would break downstream JSON decoders.
              continue;
            }
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

          if (keepsOpenAIResponsesFormat && !streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }
          streamDoneSent = true;
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
        if (extracted) state.usage = mergeUsage(state.usage, extracted); // Keep original usage for logging

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
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }

          // [diag:ollama-passthrough-eof] detect orphaned tool_use blocks at
          // stream end. If toolBlocks still has entries here, the upstream
          // ended mid-tool_use (no content_block_stop arrived) and our buffered
          // input_json_delta fragments are about to be silently dropped — the
          // client already got content_block_start and will see an incomplete
          // tool_use → "JSON Parse error: Unexpected EOF". Remove after validation.
          if (passthroughToolState?.toolBlocks?.size > 0) {
            const orphaned = [...passthroughToolState.toolBlocks.values()]
              .map(b => `${b.id}:${b.name}(${b.fragments.length} frags)`);
            console.log("[ollama-passthrough-eof] orphaned tool_use blocks:", orphaned.join(", "));
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
          // Gemini-family clients (Antigravity, Vertex, Gemini) reject this sentinel with 400 syntax errors.
          const isGeminiFamily = provider === "antigravity" || provider === "gemini" || provider === "vertex";
          if (!streamDoneSent && !isGeminiFamily) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }

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

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        if (keepsOpenAIResponsesFormat && !openAIResponsesDoneSent && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
          openAIResponsesDoneSent = true;
          streamDoneSent = true;
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

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, sourceFormat = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    sourceFormat
  });
}
