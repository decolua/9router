import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { PROVIDERS } from "../config/providers.js";
import { liftReasoningAliases } from "../translator/concerns/reasoning.js";
import { appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, hasStreamOutput, detectSseEventError, buildStreamErrorBytes, fixInvalidId, formatSSE, ensureStreamToolCallIds } from "./streamHelpers.js";
import { restoreToolNames } from "./opencodeFingerprint.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, buildAbortedResponsesTerminalBytes, normalizeResponsesErrorEvent } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { HTTP_STATUS, STREAM_TERMINAL_GRACE_MS } from "../config/runtimeConfig.js";
import { STREAM_FAILURE_MESSAGES } from "../config/errorConfig.js";
import { describeUpstreamDisconnect, getClientErrorStatus, getStreamErrorStatus, getUpstreamDisconnectStatus, isTransientStreamError } from "./error.js";
import { CLAUDE_EVENT, OPENAI_FINISH, RESPONSES_EVENT, RESPONSES_INCOMPLETE_REASON } from "../translator/schema/index.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";

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
    customToolNames = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
    credentials = null,
    requireUpstreamTerminal = false,
    onStreamFailure,
  } = options;

  let buffer = "";
  let usage = null;

  // Tool-call ids already sent to the client, keyed by the tool-call index.
  // A late fragment that opens a NEW index without an id must not reach the
  // client as-is: strict OpenAI-compatible SDKs abort the turn on a
  // tool_call without a string id (#4992).
  const seenToolCallIds = new Map();

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE
    ? { ...initState(sourceFormat), provider, toolNameMap, customToolNames: new Set(customToolNames || []), model, sessionId: credentials?._clientSessionId || null,
        // Which upstream format this stream came from. A response translator can be
        // reached either directly (target === its registered source) or as the second
        // hop of a pivot, and on the terminal null chunk the pivot drops it — so a
        // translator that defers closing events until flush needs to know which case
        // it is in. Absent/undefined means "unknown", i.e. do not defer.
        targetFormat, deferResponsesTerminal: requireUpstreamTerminal && targetFormat === FORMATS.CLAUDE && sourceFormat === FORMATS.OPENAI_RESPONSES }
    : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let streamDoneSent = false;  // track duplicate [DONE] across transform + flush
  let finalized = false;
  let completionFlushTimer = null;
  let protocolFinalized = false;
  let flushing = false;
  let lifecycle;
  let upstreamFailure;
  let upstreamTerminal;
  let finishReason;
  let responseId;
  let streamFailed = false;
  let outputSeen = false;
  let usageEstimated = false;
  const finishedChoices = new Set();
  const expectedChoices = Number.isInteger(body?.n) && body.n > 0 ? body.n : 1;
  const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;

  const clearCompletionTimer = () => {
    clearTimeout(completionFlushTimer);
    completionFlushTimer = null;
  };
  function notify(callback, ...args) {
    if (!callback) return;
    const report = (error) => console.error("[SSE] Stream callback failed:", error?.message || error);
    try { void Promise.resolve(callback(...args)).catch(report); }
    catch (error) { report(error); }
  }
  const diagnostics = () => ({
    finishReason, terminalEventType: upstreamTerminal, usageEstimated, firstOutputAt: ttftAt, outputSeen,
    upstreamResponseId: responseId,
  });

  function markOutput() {
    if (outputSeen) return;
    outputSeen = true;
    ttftAt = Date.now();
    lifecycle?.onOutput();
  }

  function emitFailure(controller, message, status = HTTP_STATUS.BAD_GATEWAY) {
    if (streamFailed || finalized) return;
    streamFailed = true;
    clearCompletionTimer();
    // Close a possibly unfinished passthrough event before writing the error event.
    if (mode === STREAM_MODE.PASSTHROUGH) controller.enqueue(sharedEncoder.encode("\n\n"));
    controller.enqueue(sourceFormat === FORMATS.OPENAI_RESPONSES
      ? buildAbortedResponsesTerminalBytes(message, status, responseId || state?.responseId)
      : buildStreamErrorBytes(status, message, sourceFormat));
    const failure = Object.assign(new Error(message), { status });
    lifecycle?.endUpstream();
    notify(lifecycle?.onSettled, failure);
    let partialUsage = mode === STREAM_MODE.PASSTHROUGH ? usage : state?.usage;
    if (!hasValidUsage(partialUsage) && totalContentLength > 0) {
      partialUsage = estimateUsage(body, totalContentLength, sourceFormat);
      usageEstimated = true;
    }
    notify(onStreamFailure, { ...diagnostics(), message, status, usage: partialUsage, phase: "committed" });
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${status}` }).catch(() => {});
    notify(reqLogger?.logError && ((...args) => reqLogger.logError(...args)), failure, body);
  }

  function observeEvent(controller, payload, eventName) {
    if (targetFormat === FORMATS.OPENAI_RESPONSES) responseId ||= payload?.response?.id;
    if (lifecycle || requireUpstreamTerminal) {
      const error = detectSseEventError(payload, eventName);
      if (error) {
        const status = getStreamErrorStatus(error) ?? HTTP_STATUS.BAD_GATEWAY;
        const code = isTransientStreamError(error.code) ? HTTP_STATUS.BAD_GATEWAY : getClientErrorStatus(status, error.message);
        emitFailure(controller, error.message, code);
        return false;
      }
    }
    if (hasStreamOutput(payload, eventName)) markOutput();
    if (targetFormat === FORMATS.OPENAI_RESPONSES && typeof payload.delta === "string") {
      const name = getOpenAIResponsesEventName(eventName, payload);
      if (name?.includes("reasoning")) {
        accumulatedThinking += payload.delta;
        totalContentLength += payload.delta.length;
      } else if (name === RESPONSES_EVENT.OUTPUT_TEXT_DELTA) {
        accumulatedContent += payload.delta;
        totalContentLength += payload.delta.length;
      }
    }
    if (targetFormat === FORMATS.OPENAI && Array.isArray(payload?.choices)) {
      for (const [index, choice] of payload.choices.entries()) {
        if (!choice?.finish_reason) continue;
        finishedChoices.add(choice.index ?? index);
        if (!finishReason || choice.finish_reason === OPENAI_FINISH.LENGTH) finishReason = choice.finish_reason;
      }
      if (finishedChoices.size >= expectedChoices) upstreamTerminal ||= "chat.finish_reason";
    } else if (targetFormat === FORMATS.CLAUDE) {
      finishReason ||= payload?.delta?.stop_reason;
      if (eventName === CLAUDE_EVENT.MESSAGE_STOP || payload?.type === CLAUDE_EVENT.MESSAGE_STOP) upstreamTerminal = CLAUDE_EVENT.MESSAGE_STOP;
    } else if (targetFormat === FORMATS.OPENAI_RESPONSES && isOpenAIResponsesTerminalEvent(eventName, payload)) {
      upstreamTerminal = getOpenAIResponsesEventName(eventName, payload) || payload.response?.status;
      finishReason = payload.response?.incomplete_details?.reason || payload.response?.status;
    }
    return true;
  }

  const sendDone = (controller) => {
    if (streamDoneSent) return;
    streamDoneSent = true;
    reqLogger?.appendConvertedChunk?.(SSE_DONE);
    controller.enqueue(sharedEncoder.encode(SSE_DONE));
  };

  function closeAfterTerminal(controller) {
    if (flushing) return;
    buffer = "";
    transformer.flush(controller);
    lifecycle?.endUpstream();
  }

  function handleDone(controller) {
    if (targetFormat === FORMATS.OPENAI) upstreamTerminal ||= "chat.done";
    if (lifecycle && (upstreamTerminal || requireUpstreamTerminal || keepsOpenAIResponsesFormat)) {
      closeAfterTerminal(controller);
      return true;
    }
    return false;
  }

  function scheduleTerminalGrace(controller) {
    if (flushing || targetFormat !== FORMATS.OPENAI || completionFlushTimer || finalized) return;
    const waiting = lifecycle ? upstreamTerminal : (state?.completionPending && !state.completedSent);
    if (!waiting) return;
    lifecycle?.onTerminalGrace();
    const finish = () => {
      completionFlushTimer = null;
      if (lifecycle) closeAfterTerminal(controller);
      else if (!state.completedSent) flushPendingCompletion(controller);
    };
    if (STREAM_TERMINAL_GRACE_MS > 0) completionFlushTimer = setTimeout(finish, STREAM_TERMINAL_GRACE_MS);
    else finish();
  }

  // Lane quirk: upstream streams thinking under the OpenRouter aliases
  // (`reasoning` / `reasoning_details[]`) instead of reasoning_content — OpenCode
  // Free's MiMo route does. Lift it on every passthrough delta so OpenAI-shaped
  // clients, the thinking accumulation below and usage accounting see the text.
  const liftAliases = mode === STREAM_MODE.PASSTHROUGH && !!PROVIDERS[provider]?.quirks?.reasoningAliasFields;

  // Usage/logging tail, callable from transform() as well as flush(): a client that
  // closes right after the terminal event cancels the reader, and flush() never runs.
  const finalizeStream = () => {
    clearCompletionTimer();
    if (finalized || streamFailed) return;
    finalized = true;

    const isPassthrough = mode === STREAM_MODE.PASSTHROUGH;
    let finalUsage = isPassthrough ? usage : state?.usage;

    if (!hasValidUsage(finalUsage) && totalContentLength > 0) {
      finalUsage = estimateUsage(body, totalContentLength, isPassthrough ? FORMATS.OPENAI : sourceFormat);
      usageEstimated = true;
      if (isPassthrough) usage = finalUsage; else state.usage = finalUsage;
    }

    if (hasValidUsage(finalUsage)) {
      logUsage(isPassthrough ? provider : (state?.provider || targetFormat), finalUsage, model, connectionId, apiKey);
    } else {
      appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
    }

    notify(lifecycle?.onSettled);
    notify(onStreamComplete, { content: accumulatedContent, thinking: accumulatedThinking }, finalUsage, ttftAt, diagnostics());
  };

  // Emit the deferred response.completed now — at [DONE], or when the watchdog
  // below gives up on a usage trailer that never arrives.
  const flushPendingCompletion = (controller) => {
    const completed = translateResponse(targetFormat, sourceFormat, null, state);
    for (const item of completed || []) {
      if (item === null || item === undefined) continue;
      const output = formatSSE(item, sourceFormat);
      reqLogger?.appendConvertedChunk?.(output);
      controller.enqueue(sharedEncoder.encode(output));
      sseEmittedCount++;
    }
    finalizeStream();
  };

  const transformer = {
    transform(chunk, controller) {
      if (protocolFinalized || streamFailed) return;
      const text = decoder.decode(chunk, { stream: true });
      reqLogger?.appendProviderChunk?.(text);
      transformer.processText(text, controller);
    },
    processText(text, controller) {
      buffer += text;
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
        if (trimmed.startsWith("event:")) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        } else if (!trimmed) currentOpenAIResponsesEvent = null;

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;
          let responsesTerminal = false;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() === "[DONE]") {
            if (handleDone(controller)) return;
            sendDone(controller);
            return;
          }
          if (streamDoneSent) return;
          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              let parsed = JSON.parse(trimmed.slice(5).trim());
              const eventName = currentOpenAIResponsesEvent;
              currentOpenAIResponsesEvent = null;
              if (!parsed || typeof parsed !== "object") continue;
              if (!observeEvent(controller, parsed, eventName)) return;
              const idFixed = fixInvalidId(parsed);
              const normalizedError = normalizeResponsesErrorEvent(parsed);
              const errorNormalized = normalizedError !== parsed;
              parsed = normalizedError;

              // A fragment that opens a new tool-call index without an id breaks
              // strict OpenAI-compatible clients. Mint/reuse one before the
              // chunk reaches the client.
              const toolCallIdFixed = ensureStreamToolCallIds(parsed, seenToolCallIds);

              // The fingerprint pass renames a colliding caller tool to an alias
              // (read -> read_client). On this path nothing restored it, so the
              // client received a call to a tool it never declared and answered
              // "Model tried to call unavailable tool 'read_client'" (#4986).
              let toolNameRestored = false;
              if (toolNameMap?.size) {
                const restored = restoreToolNames(parsed, toolNameMap);
                if (restored !== parsed) {
                  parsed = restored;
                  toolNameRestored = true;
                }
              }

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

              // Alias lanes: expose thinking as reasoning_content (additive) before
              // the valuable-content check, so reasoning-only chunks survive.
              if (liftAliases && parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice?.delta) {
                    const lifted = liftReasoningAliases(choice.delta);
                    if (lifted !== choice.delta) {
                      choice.delta = lifted;
                      fieldsInjected = true;
                    }
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
              const reasoning = delta?.reasoning_content ?? delta?.reasoning;
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
                usage = mergeUsage(usageEstimated ? null : usage, extracted);
                usageEstimated = false;
              }

              responsesTerminal = targetFormat === FORMATS.OPENAI_RESPONSES && isOpenAIResponsesTerminalEvent(eventName, parsed);

              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(usage)) {
                const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                usage = estimated;
                usageEstimated = true;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              } else if (idFixed || fieldsInjected || toolCallIdFixed || toolNameRestored || errorNormalized) {
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
          if (lifecycle && upstreamTerminal && targetFormat !== FORMATS.OPENAI) {
            controller.enqueue(sharedEncoder.encode("\n"));
            closeAfterTerminal(controller);
            return;
          }
          // Responses clients (codex CLI) close on response.completed instead of [DONE]
          if (responsesTerminal) finalizeStream();
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;

        // Responses API same-format passthrough: preserve event framing + track terminal state
        const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
        const openAIResponsesEventName = isOpenAIResponsesStream
          ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed)
          : null;

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed.done && targetFormat !== FORMATS.OLLAMA) {
          if (handleDone(controller)) return;
          if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES
            && state.completionPending && !state.completedSent) flushPendingCompletion(controller);
          if (keepsOpenAIResponsesFormat) {
            if (!upstreamTerminal) emitFailure(controller, STREAM_FAILURE_MESSAGES.missingTerminal);
            else sendDone(controller);
          }
          continue;
        }
        if (!observeEvent(controller, parsed, currentOpenAIResponsesEvent)) return;

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
        const delta = parsed.choices?.[0]?.delta;
        if (typeof delta?.content === "string") {
          totalContentLength += delta.content.length;
          accumulatedContent += delta.content;
        }
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === "string") {
          totalContentLength += reasoning.length;
          accumulatedThinking += reasoning;
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
        if (extracted) {
          state.usage = mergeUsage(usageEstimated ? null : state.usage, extracted);
          usageEstimated = false;
        }

        // Responses same-format passthrough: re-emit with original event framing
        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          const passthroughData = normalizeResponsesErrorEvent(parsed);
          const output = formatSSE({ event: openAIResponsesEventName, data: passthroughData }, sourceFormat);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          // Responses clients (codex) close on response.completed instead of [DONE]
          if (upstreamTerminal) {
            if (lifecycle) { closeAfterTerminal(controller); return; }
            finalizeStream();
          }
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

        let clientTerminal = false;
        if (translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === CLAUDE_EVENT.MESSAGE_DELTA || item.choices?.[0]?.finish_reason;
            const genuineResponsesLimit = sourceFormat === FORMATS.OPENAI && targetFormat === FORMATS.OPENAI_RESPONSES
              && finishReason === RESPONSES_INCOMPLETE_REASON.MAX_OUTPUT_TOKENS;
            if (!genuineResponsesLimit && state.finishReason && isFinishChunk && !hasValidUsage(item.usage)
              && !hasValidUsage(state.usage) && totalContentLength > 0) {
              const estimated = estimateUsage(body, totalContentLength, sourceFormat);
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
              state.usage = estimated;
              usageEstimated = true;
            } else if (!genuineResponsesLimit && state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            sseEmittedCount++;
            clientTerminal ||= item.type === CLAUDE_EVENT.MESSAGE_STOP
              || (sourceFormat === FORMATS.OPENAI_RESPONSES && isOpenAIResponsesTerminalEvent(item.event, item.data));
          }
        }

        if (lifecycle && ((upstreamTerminal && targetFormat !== FORMATS.OPENAI)
          || (clientTerminal && (!requireUpstreamTerminal || upstreamTerminal)))) {
          closeAfterTerminal(controller);
          return;
        }
      }
      scheduleTerminalGrace(controller);
    },

    flush(controller) {
      if (protocolFinalized || streamFailed) return;
      flushing = true;
      clearCompletionTimer();
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      try {
        if (upstreamFailure && !upstreamTerminal) {
          emitFailure(controller, describeUpstreamDisconnect(upstreamFailure), getUpstreamDisconnectStatus(upstreamFailure));
          return;
        }
        if (!upstreamFailure) {
          const tail = decoder.decode();
          if (buffer || tail) transformer.processText(tail + "\n\n", controller);
        }
        if (streamFailed) return;
        if ((requireUpstreamTerminal || keepsOpenAIResponsesFormat) && !upstreamTerminal) {
          emitFailure(controller, STREAM_FAILURE_MESSAGES.missingTerminal);
          return;
        }
        if (mode === STREAM_MODE.PASSTHROUGH) {
          // Leave native Claude/Gemini framing alone. Chat clients expect [DONE].
          if (sourceFormat !== FORMATS.CLAUDE && ![FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY].includes(sourceFormat)) {
            sendDone(controller);
          }
          finalizeStream();
          return;
        }

        let flushed;
        if (state.deferResponsesTerminal) {
          state.deferResponsesTerminal = false;
          // The Claude-to-Chat pivot does not forward a null flush to Responses.
          flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
        } else if (upstreamTerminal === "chat.done" && sourceFormat === FORMATS.CLAUDE && state.messageStartSent) {
          const reason = state.toolCalls?.size ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP;
          flushed = translateResponse(targetFormat, sourceFormat, { choices: [{ delta: {}, finish_reason: reason }] }, state);
        } else flushed = translateResponse(targetFormat, sourceFormat, null, state);

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

        if (keepsOpenAIResponsesFormat || (lifecycle && sourceFormat === FORMATS.OPENAI)) sendDone(controller);

        finalizeStream();
      } catch (error) {
        console.error("[SSE] Failed to finish upstream stream:", error?.message);
        emitFailure(controller, "Failed to finish upstream stream");
      } finally {
        flushing = false;
        protocolFinalized = true;
      }
    }
  };
  const transform = new TransformStream({ transform: transformer.transform, flush: transformer.flush });
  transform.hasTerminal = () => finalized || streamFailed;
  transform.getResponseId = () => responseId || state?.responseId;
  transform.hasOutput = () => outputSeen;
  transform.setUpstreamFailure = (error) => { upstreamFailure = error; };
  transform.setStreamLifecycle = (hooks) => { lifecycle = hooks; };
  transform.clearCompletionTimer = clearCompletionTimer;
  return transform;
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, customToolNames = null, credentials = null, lifecycleOptions) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    customToolNames,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    credentials,
    ...lifecycleOptions,
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, toolNameMap = null, sourceFormat, lifecycleOptions) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    sourceFormat,
    targetFormat: sourceFormat,
    ...lifecycleOptions,
  });
}
