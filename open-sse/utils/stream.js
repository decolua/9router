import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, canonicalizeUsage, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE, buildStreamErrorBytes } from "./streamHelpers.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure, formatOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { OPENCODE_GUARD_LIMITS, restoreToolNames } from "./opencodeFingerprint.js";
import { createOpenCodeToolResponseGuard } from "./opencodeToolResponseGuard.js";

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
    onStreamFailure = null,
    apiKey = null,
    ensureOpenAIDone = false,
    credentials = null,
    onGuardFailure = null
  } = options;

  let buffer = "";
  let pendingRecord = null;
  let usage = null;
  const byteLength = (value) => sharedEncoder.encode(value).byteLength;
  const capacityError = () => {
    const error = new Error("Upstream tool response exceeded the safety buffer");
    error.code = "upstream_tool_buffer_overflow";
    return error;
  };
  // Each suffix byte belongs to exactly one owner: undecoded record prefix,
  // the record awaiting guard consumption, or the guard's held records.
  const assertGuardedSuffixCapacity = (incomingBytes = 0) => {
    const reservedBytes = byteLength(buffer) + (pendingRecord?.serializedSize || 0);
    if (reservedBytes + (toolResponseGuard?.getHeldBytes() || 0) + incomingBytes > OPENCODE_GUARD_LIMITS.MAX_BUFFERED_SUFFIX_BYTES) throw capacityError();
    toolResponseGuard?.assertCapacity();
  };
  const takeCompleteRawRecord = () => {
    let lineStart = 0;
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n", lineStart)) {
      const contentEnd = newline > lineStart && buffer[newline - 1] === "\r" ? newline - 1 : newline;
      const lineEnd = newline + 1;
      if (contentEnd === lineStart) {
        const raw = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd);
        return raw;
      }
      lineStart = lineEnd;
    }
    return null;
  };

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE
    ? { ...initState(sourceFormat), provider, toolNameMap, customToolNames: new Set(customToolNames || []), model, sessionId: credentials?._clientSessionId || null,
        // Which upstream format this stream came from. A response translator can be
        // reached either directly (target === its registered source) or as the second
        // hop of a pivot, and on the terminal null chunk the pivot drops it — so a
        // translator that defers closing events until flush needs to know which case
        // it is in. Absent/undefined means "unknown", i.e. do not defer.
        targetFormat }
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
  let openAIResponsesStreamSeen = false;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false;  // track duplicate [DONE] across transform + flush
  let finalized = false;
  let guardFailed = false;
  let semanticFailure = null;
  let semanticFailureReported = false;
  const reportSemanticFailure = () => {
    if (!semanticFailure || semanticFailureReported) return;
    semanticFailureReported = true;
    const finalUsage = mode === STREAM_MODE.PASSTHROUGH ? usage : state?.usage;
    onStreamFailure?.({ ...semanticFailure, usage: finalUsage || null });
  };
  const toolResponseGuard = toolNameMap?.injectedNames
    ? createOpenCodeToolResponseGuard(toolNameMap, {
        getReservedBytes: () => byteLength(buffer) + (pendingRecord?.serializedSize || 0),
      })
    : null;
  const captureSemanticFailure = (eventName, parsed) => {
    if (parsed?.response?.usage) {
      const responseUsage = parsed.response.usage;
      const normalizedUsage = canonicalizeUsage({
        prompt_tokens: responseUsage.input_tokens ?? responseUsage.prompt_tokens,
        completion_tokens: responseUsage.output_tokens ?? responseUsage.completion_tokens,
        total_tokens: responseUsage.total_tokens,
        cached_tokens: responseUsage.cached_tokens ?? responseUsage.input_tokens_details?.cached_tokens,
        reasoning_tokens: responseUsage.output_tokens_details?.reasoning_tokens,
        prompt_tokens_details: responseUsage.input_tokens_details,
        completion_tokens_details: responseUsage.output_tokens_details,
      });
      if (mode === STREAM_MODE.PASSTHROUGH) usage = mergeUsage(usage, normalizedUsage);
      else state.usage = mergeUsage(state.usage, normalizedUsage);
    }
    const failed = eventName === "response.failed" || eventName === "error" || parsed?.type === "response.failed" || parsed?.type === "error" || parsed?.response?.status === "failed";
    if (!failed || semanticFailure) return;
    const error = parsed?.response?.error || parsed?.error || {};
      semanticFailure = {
        status: Number.isInteger(Number(error.status)) ? Number(error.status) : undefined,
        message: error.message || "Upstream stream failed",
        origin: Number.isInteger(Number(error.status)) ? "upstream_http" : "processing",
        usage: parsed?.response?.usage || null,
      };
      reportSemanticFailure();
    };
  const synthesizeSemanticFailure = () => {
    if (!semanticFailure) semanticFailure = { message: "stream closed before response.completed", origin: "processing" };
  };
  const captureProcessingFailure = (error) => {
    if (!semanticFailure) semanticFailure = { status: Number(error?.status) || 502, message: error?.message || "stream conversion failed", origin: "processing" };
  };
  const markResponsesTerminal = (eventName, parsed) => {
    if (isOpenAIResponsesTerminalEvent(eventName, parsed)) openAIResponsesTerminalSeen = true;
  };
  const markDoneSent = () => {
    streamDoneSent = true;
    openAIResponsesDoneSent = true;
  };
  const emitIncompleteResponsesFailure = (controller) => {
    synthesizeSemanticFailure();
    const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
    reqLogger?.appendConvertedChunk?.(failedOutput);
    controller.enqueue(sharedEncoder.encode(failedOutput));
    openAIResponsesTerminalSeen = true;
  };
  const emitGuardFailure = (controller, error) => {
    if (guardFailed) return;
    guardFailed = true;
    const code = typeof error?.code === "string" && error.code.startsWith("upstream_")
      ? error.code
      : "upstream_tool_guard_failed";
    semanticFailure = {
      status: 502,
      code,
      message: error?.message || "Upstream tool response failed validation",
      origin: "processing",
    };
    const output = sourceFormat === FORMATS.OPENAI_RESPONSES
      ? `${formatOpenAIResponsesStreamFailure(code, semanticFailure.message)}data: [DONE]\n\n`
      : new TextDecoder().decode(buildStreamErrorBytes(502, semanticFailure.message, sourceFormat, code));
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
    openAIResponsesTerminalSeen = sourceFormat === FORMATS.OPENAI_RESPONSES;
    markDoneSent();
    reportSemanticFailure();
    onGuardFailure?.(semanticFailure);
    finalizeStream();
  };
  const emitOutput = (controller, output) => {
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  };
  const queueGuardedOutput = emitOutput;
  const consumeToolResponse = (controller, event) => {
    if (!toolResponseGuard || guardFailed) return guardFailed ? null : [event];
    try {
      return toolResponseGuard.consume({
        payload: event.payload,
        event,
        serializedSize: event.serializedSize,
      }).releasedEvents;
    } catch (error) {
      emitGuardFailure(controller, error);
      return null;
    }
  };
  const finishToolResponse = (controller) => {
    if (!toolResponseGuard || guardFailed) return guardFailed ? null : [];
    try {
      return toolResponseGuard.finish().releasedEvents;
    } catch (error) {
      emitGuardFailure(controller, error);
      return null;
    }
  };
  const recordEventName = (lines) => {
    let eventName = null;
    for (const line of lines) {
      const match = line.match(/^event:\s*(.*)$/);
      if (match) eventName = match[1].trim();
    }
    return eventName;
  };
  const recordPayload = (lines) => {
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };
  const createRawRecord = (raw) => {
    const content = raw.endsWith("\r\n\r\n")
      ? raw.slice(0, -4)
      : (raw.endsWith("\n\n") ? raw.slice(0, -2) : raw);
    const lines = content ? content.split(/\r?\n/) : [];
    const eventName = recordEventName(lines);
    const line = lines.find((item) => item.startsWith("data:")) || "";
    return {
      record: raw,
      line,
      trimmed: line.trim(),
      eventName,
      payload: recordPayload(lines),
      serializedSize: byteLength(raw),
    };
  };
  const replayRawRecord = (record) => record.record;
  const serializeRecord = (record, payload) => {
    if (!payload) return replayRawRecord(record);
    const lineEnding = record.record.includes("\r\n") ? "\r\n" : "\n";
    const terminator = `${lineEnding}${lineEnding}`;
    const lines = record.record.slice(0, -terminator.length).split(lineEnding);
    const firstData = lines.findIndex((line) => line.startsWith("data:"));
    if (firstData < 0) return replayRawRecord(record);
    const preserved = lines.filter((line) => !line.startsWith("data:"));
    preserved.splice(firstData, 0, `data: ${JSON.stringify(payload)}`);
    return `${preserved.join(lineEnding)}${terminator}`;
  };
  const processReleasedRecord = (controller, released) => {
    const parsed = released.payload
      ? restoreToolNames(released.payload, toolNameMap?.renameMap || toolNameMap)
      : null;
    const rawChanged = parsed !== released.payload;
    const eventName = released.eventName || parsed?.type || null;
    currentOpenAIResponsesEvent = eventName;
    if (eventName?.startsWith("response.")) openAIResponsesStreamSeen = true;
    if (parsed) {
      captureSemanticFailure(eventName, parsed);
      markResponsesTerminal(eventName, parsed);
      const text = parsed.delta?.text || parsed.choices?.[0]?.delta?.content;
      const thinking = parsed.delta?.thinking || parsed.choices?.[0]?.delta?.reasoning_content;
      if (typeof text === "string") {
        totalContentLength += text.length;
        accumulatedContent += text;
      }
      if (typeof thinking === "string") {
        totalContentLength += thinking.length;
        accumulatedThinking += thinking;
      }
      for (const part of parsed.candidates?.[0]?.content?.parts || []) {
        if (typeof part?.text !== "string") continue;
        totalContentLength += part.text.length;
        if (part.thought === true) accumulatedThinking += part.text;
        else accumulatedContent += part.text;
      }
      const extracted = extractUsage(parsed);
      if (extracted) {
        if (mode === STREAM_MODE.PASSTHROUGH) usage = mergeUsage(usage, extracted);
        else state.usage = mergeUsage(state.usage, extracted);
      }
    }
    if (mode === STREAM_MODE.PASSTHROUGH) {
      const isResponsesPassthrough = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
      if (released.trimmed === "data: [DONE]") {
        if (isResponsesPassthrough && openAIResponsesStreamSeen && !openAIResponsesTerminalSeen) emitIncompleteResponsesFailure(controller);
        markDoneSent();
      }
      return { parsed, eventName, rawChanged };
    }
    if (!parsed) return { parsed, eventName, rawChanged };
    const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
    const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
    const openAIResponsesEventName = isOpenAIResponsesStream
      ? getOpenAIResponsesEventName(eventName, parsed)
      : null;
    if (isOpenAIResponsesStream) markResponsesTerminal(openAIResponsesEventName, parsed);
    if (parsed.done && targetFormat !== FORMATS.OLLAMA) {
      if ((keepsOpenAIResponsesFormat || openAIResponsesStreamSeen) && !openAIResponsesTerminalSeen) emitIncompleteResponsesFailure(controller);
      if ((ensureOpenAIDone || keepsOpenAIResponsesFormat) && !streamDoneSent) queueGuardedOutput(controller, "data: [DONE]\n\n");
      markDoneSent();
      return { parsed: null, eventName };
    }
    return { parsed, eventName, rawChanged, keepsOpenAIResponsesFormat, openAIResponsesEventName };
  };
  const captureResponsesTail = () => {
    const eventMatch = buffer.match(/(?:^|\n)event:\s*([^\r\n]+)/);
    if (eventMatch) {
      currentOpenAIResponsesEvent = eventMatch[1].trim();
      if (currentOpenAIResponsesEvent.startsWith("response.")) openAIResponsesStreamSeen = true;
    }
    const dataMatch = buffer.match(/(?:^|\n)data:\s*([^\r\n]+)\s*$/);
    if (!dataMatch || dataMatch[1] === "[DONE]") return;
    try {
      const parsed = JSON.parse(dataMatch[1]);
      markResponsesTerminal(currentOpenAIResponsesEvent, parsed);
      captureSemanticFailure(currentOpenAIResponsesEvent, parsed);
    } catch (error) {
      captureProcessingFailure(error);
    }
  };

  // Usage/logging tail, callable from transform() as well as flush(): a client that
  // closes right after the terminal event cancels the reader, and flush() never runs.
  const finalizeStream = () => {
    if (finalized) return;
    finalized = true;

    const isPassthrough = mode === STREAM_MODE.PASSTHROUGH;
    let finalUsage = isPassthrough ? usage : state?.usage;

    if (semanticFailure) {
      appendRequestLog({ model, provider, connectionId, tokens: finalUsage || null, status: `FAILED ${semanticFailure.status || 502}` }).catch(() => {});
      reportSemanticFailure();
      return;
    }

    if (!hasValidUsage(finalUsage) && totalContentLength > 0) {
      finalUsage = estimateUsage(body, totalContentLength, isPassthrough ? FORMATS.OPENAI : sourceFormat);
      if (isPassthrough) usage = finalUsage; else state.usage = finalUsage;
    }

    if (hasValidUsage(finalUsage)) {
      logUsage(isPassthrough ? provider : (state?.provider || targetFormat), finalUsage, model, connectionId, apiKey);
    } else {
      appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
    }

    if (onStreamComplete) {
      onStreamComplete({
        content: accumulatedContent,
        thinking: accumulatedThinking
      }, finalUsage, ttftAt);
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (guardFailed) return;
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      try {
        if (toolResponseGuard) assertGuardedSuffixCapacity(byteLength(text));
      } catch (error) {
        emitGuardFailure(controller, error);
        return;
      }
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = toolResponseGuard ? null : buffer.split("\n");
      if (lines) buffer = lines.pop() || "";
      const processEvent = (event) => {
        const { line, trimmed } = event;
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
          if (currentOpenAIResponsesEvent.startsWith("response.")) openAIResponsesStreamSeen = true;
        }

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (!toolResponseGuard) {
            const isDataLine = trimmed.startsWith("data:");
            const parsed = parseSSELine(trimmed, targetFormat);
            if (!parsed) {
              // A data: line that failed JSON parsing carries upstream garbage
              // (HTML, rate-limit text) — drop it silently, matching committed
              // passthrough behavior. Non-data lines (event:, comments) still forward.
              if (isDataLine && trimmed.slice(5).trim() !== "[DONE]") return;
              queueGuardedOutput(controller, line.startsWith("data:") && !line.startsWith("data: ")
                ? `data: ${line.slice(5)}\n`
                : `${line}\n`);
              return;
            }
            captureSemanticFailure(currentOpenAIResponsesEvent, parsed);
            markResponsesTerminal(currentOpenAIResponsesEvent, parsed);
            if (parsed.done && targetFormat !== FORMATS.OLLAMA) {
              const isResponsesPassthrough = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
              if (isResponsesPassthrough && openAIResponsesStreamSeen && !openAIResponsesTerminalSeen) emitIncompleteResponsesFailure(controller);
              markDoneSent();
              queueGuardedOutput(controller, line.startsWith("data:") && !line.startsWith("data: ")
                ? `data: ${line.slice(5)}\n`
                : `${line}\n`);
              return;
            }
            const text = parsed.delta?.text || parsed.choices?.[0]?.delta?.content;
            const thinking = parsed.delta?.thinking || parsed.choices?.[0]?.delta?.reasoning_content;
            if (typeof text === "string") {
              totalContentLength += text.length;
              accumulatedContent += text;
            }
            if (typeof thinking === "string") {
              totalContentLength += thinking.length;
              accumulatedThinking += thinking;
            }
            for (const part of parsed.candidates?.[0]?.content?.parts || []) {
              if (typeof part?.text !== "string") continue;
              totalContentLength += part.text.length;
              if (part.thought === true) accumulatedThinking += part.text;
              else accumulatedContent += part.text;
            }
            const extracted = extractUsage(parsed);
            if (extracted) usage = mergeUsage(usage, extracted);
            if (trimmed === "data: [DONE]") {
              const isResponsesPassthrough = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
              if (isResponsesPassthrough && openAIResponsesStreamSeen && !openAIResponsesTerminalSeen) emitIncompleteResponsesFailure(controller);
              markDoneSent();
            }
            const idFixed = fixInvalidId(parsed);
            let fieldsInjected = false;
            if (parsed.choices !== undefined) {
              if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
              if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
            }
            if (parsed.prompt_filter_results !== undefined) {
              delete parsed.prompt_filter_results;
              fieldsInjected = true;
            }
            if (parsed.choices) {
              for (const choice of parsed.choices) {
                if (choice.content_filter_results !== undefined) {
                  delete choice.content_filter_results;
                  fieldsInjected = true;
                }
                if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                  delete choice.delta.tool_calls;
                  fieldsInjected = true;
                }
              }
            }
            if (!hasValuableContent(parsed, FORMATS.OPENAI)) return;
            const isFinishChunk = parsed.choices?.[0]?.finish_reason;
            if (isFinishChunk && !hasValidUsage(parsed.usage)) {
              const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
              parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
              usage = estimated;
            } else if (isFinishChunk && usage) {
              parsed.usage = filterUsageForFormat(addBufferToUsage(usage), FORMATS.OPENAI);
            }
            queueGuardedOutput(controller, idFixed || fieldsInjected || isFinishChunk
              ? `data: ${JSON.stringify(parsed)}\n`
              : (line.startsWith("data:") && !line.startsWith("data: ") ? `data: ${line.slice(5)}\n` : `${line}\n`));
            return;
          }
          const releasedEvents = consumeToolResponse(controller, event);
          if (releasedEvents === null) return;
          for (const released of releasedEvents) {
            const releasedLine = released.line;
            let output;
            let injectedUsage = false;
            const { parsed, rawChanged } = processReleasedRecord(controller, released);
            if (parsed) {
              const idFixed = fixInvalidId(parsed);
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
                if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
              }
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }
              if (!hasValuableContent(parsed, FORMATS.OPENAI)) continue;
              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                usage = estimated;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                parsed.usage = filterUsageForFormat(addBufferToUsage(usage), FORMATS.OPENAI);
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                injectedUsage = true;
              }
              if (injectedUsage || rawChanged) output = serializeRecord(released, parsed);
            }
            if (!output) {
              output = released.record ? replayRawRecord(released) : (releasedLine.startsWith("data:") && !releasedLine.startsWith("data: ")
                ? `data: ${releasedLine.slice(5)}\n`
                : `${releasedLine}\n`);
            }
            queueGuardedOutput(controller, output);
          }
          return;
        }

        // Translate mode
        if (!trimmed) return;

        if (!toolResponseGuard) {
          const payload = parseSSELine(trimmed, targetFormat);
          if (!payload) return;
          if (payload.done && targetFormat !== FORMATS.OLLAMA) {
            const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
            if ((keepsOpenAIResponsesFormat || openAIResponsesStreamSeen) && !openAIResponsesTerminalSeen) emitIncompleteResponsesFailure(controller);
            if ((ensureOpenAIDone || keepsOpenAIResponsesFormat) && !streamDoneSent) queueGuardedOutput(controller, "data: [DONE]\n\n");
            markDoneSent();
            return;
          }
          const text = payload.delta?.text || payload.choices?.[0]?.delta?.content;
          const thinking = payload.delta?.thinking || payload.choices?.[0]?.delta?.reasoning_content;
          if (typeof text === "string") {
            totalContentLength += text.length;
            accumulatedContent += text;
          }
          if (typeof thinking === "string") {
            totalContentLength += thinking.length;
            accumulatedThinking += thinking;
          }
          for (const part of payload.candidates?.[0]?.content?.parts || []) {
            if (typeof part?.text !== "string") continue;
            totalContentLength += part.text.length;
            if (part.thought === true) accumulatedThinking += part.text;
            else accumulatedContent += part.text;
          }
          const extracted = extractUsage(payload);
          if (extracted) state.usage = mergeUsage(state.usage, extracted);
          const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
          const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
          const openAIResponsesEventName = isOpenAIResponsesStream
            ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, payload)
            : null;
          if (isOpenAIResponsesStream) captureSemanticFailure(openAIResponsesEventName, payload);
          if (isOpenAIResponsesStream) markResponsesTerminal(openAIResponsesEventName, payload);

          // Responses same-format passthrough: re-emit with original event framing
          // instead of round-tripping through the OpenAI-pivot translator.
          if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
            const output = formatSSE({ event: openAIResponsesEventName, data: payload }, sourceFormat);
            queueGuardedOutput(controller, output);
            currentOpenAIResponsesEvent = null;
            sseEmittedCount++;
            return;
          }

          let translated;
          try {
            translated = translateResponse(targetFormat, sourceFormat, payload, state);
          } catch (error) {
            error.streamOrigin = "processing";
            error.status = 502;
            captureProcessingFailure(error);
            finalizeStream();
            throw error;
          }
          if (translated?._openaiIntermediate) {
            for (const item of translated._openaiIntermediate) {
              reqLogger?.appendOpenAIChunk?.(formatSSE(item, FORMATS.OPENAI));
            }
          }
          for (const item of translated || []) {
            if (item === null || item === undefined || !hasValuableContent(item, sourceFormat)) continue;
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = estimateUsage(body, totalContentLength, sourceFormat);
              item.usage = filterUsageForFormat(estimated, sourceFormat);
              state.usage = estimated;
            } else if (state.finishReason && isFinishChunk && state.usage) {
              item.usage = filterUsageForFormat(addBufferToUsage(state.usage), sourceFormat);
            }
            queueGuardedOutput(controller, formatSSE(item, sourceFormat));
            sseEmittedCount++;
          }
          currentOpenAIResponsesEvent = null;
          return;
        }
 
        const payload = event.payload || parseSSELine(trimmed, targetFormat);
        const releasedEvents = consumeToolResponse(controller, {
          ...event,
          payload,
          eventName: event.eventName,
        });
        if (releasedEvents === null) return;
        for (const released of releasedEvents) {
          const processed = processReleasedRecord(controller, released);
          const { parsed, keepsOpenAIResponsesFormat, openAIResponsesEventName } = processed;
          if (!parsed) continue;

        // Responses same-format passthrough: re-emit with original event framing
        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          const output = formatSSE({ event: openAIResponsesEventName, data: parsed }, sourceFormat);
          queueGuardedOutput(controller, output);
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          continue;
        }

        currentOpenAIResponsesEvent = null;

        // Translate: targetFormat -> openai -> sourceFormat
        let translated;
        try {
          translated = translateResponse(targetFormat, sourceFormat, parsed, state);
        } catch (error) {
          error.streamOrigin = "processing";
          error.status = 502;
          captureProcessingFailure(error);
          finalizeStream();
          throw error;
        }

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
            queueGuardedOutput(controller, output);
            sseEmittedCount++;
          }
        }
        }
      };
      try {
        if (toolResponseGuard) {
          let rawRecord;
          while ((rawRecord = takeCompleteRawRecord()) !== null) {
            pendingRecord = createRawRecord(rawRecord);
            assertGuardedSuffixCapacity();
            const record = pendingRecord;
            pendingRecord = null;
            processEvent(record);
            assertGuardedSuffixCapacity();
          }
          assertGuardedSuffixCapacity();
        } else {
          for (const line of lines) processEvent({ line, trimmed: line.trim(), payload: null, eventName: null, serializedSize: sharedEncoder.encode(`${line}\n`).byteLength });
        }
      } catch (error) {
        emitGuardFailure(controller, error);
      }
    },

    flush(controller) {
      if (guardFailed) return;
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining && toolResponseGuard) assertGuardedSuffixCapacity(byteLength(remaining));
        if (remaining) buffer += remaining;
        if (toolResponseGuard) assertGuardedSuffixCapacity();
 
        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            pendingRecord = createRawRecord(buffer);
            buffer = "";
            assertGuardedSuffixCapacity();
            const record = pendingRecord;
            pendingRecord = null;
            const releasedEvents = consumeToolResponse(controller, record);
            assertGuardedSuffixCapacity();
            if (releasedEvents === null) return;
            for (const released of releasedEvents) {
              const { parsed, rawChanged } = processReleasedRecord(controller, released);
              queueGuardedOutput(controller, rawChanged ? serializeRecord(released, parsed) : replayRawRecord(released));
            }
          }
          const releasedEvents = finishToolResponse(controller);
          if (releasedEvents === null) return;
          for (const released of releasedEvents) {
            const { parsed, rawChanged } = processReleasedRecord(controller, released);
            queueGuardedOutput(controller, rawChanged ? serializeRecord(released, parsed) : replayRawRecord(released));
          }
          const isResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
          if (isResponsesStream && openAIResponsesStreamSeen && !openAIResponsesTerminalSeen) {
            emitIncompleteResponsesFailure(controller);
          }
          const isGeminiFamily = provider === "antigravity" || provider === "gemini" || provider === "vertex";
          if (!streamDoneSent && !isGeminiFamily) {
            queueGuardedOutput(controller, "data: [DONE]\n\n");
            markDoneSent();
          }
          finalizeStream();
          return;
        }

        if (!toolResponseGuard && buffer.trim()) {
          const payload = parseSSELine(buffer.trim(), targetFormat);
          if (payload) {
            const translated = translateResponse(targetFormat, sourceFormat, payload, state);
            for (const item of translated || []) {
              if (item !== null && item !== undefined) queueGuardedOutput(controller, formatSSE(item, sourceFormat));
            }
          }
        }
        if (toolResponseGuard && buffer) {
          pendingRecord = createRawRecord(buffer);
          buffer = "";
          assertGuardedSuffixCapacity();
          const record = pendingRecord;
          pendingRecord = null;
          const releasedEvents = consumeToolResponse(controller, record);
          assertGuardedSuffixCapacity();
          if (releasedEvents === null) return;
          for (const released of releasedEvents) {
            const { parsed } = processReleasedRecord(controller, released);
            if (!parsed) continue;
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);
            for (const item of translated || []) {
              if (item !== null && item !== undefined) queueGuardedOutput(controller, formatSSE(item, sourceFormat));
            }
          }
        }
        const releasedEvents = finishToolResponse(controller);
        if (releasedEvents === null) return;
        for (const released of releasedEvents) {
          const { parsed } = processReleasedRecord(controller, released);
          if (!parsed) continue;
          const translated = translateResponse(targetFormat, sourceFormat, parsed, state);
          for (const item of translated || []) {
            if (item !== null && item !== undefined) queueGuardedOutput(controller, formatSSE(item, sourceFormat));
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
            queueGuardedOutput(controller, output);
          }
        }

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
          if ((keepsOpenAIResponsesFormat || openAIResponsesStreamSeen) && !openAIResponsesTerminalSeen) {
            emitIncompleteResponsesFailure(controller);
          }

        if ((ensureOpenAIDone || keepsOpenAIResponsesFormat) && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          queueGuardedOutput(controller, doneOutput);
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          streamDoneSent = true;
        }

        finalizeStream();
      } catch (error) {
        if (error?.code === "upstream_tool_buffer_overflow") {
          emitGuardFailure(controller, error);
          return;
        }
        captureProcessingFailure(error);
        console.warn(`[SSE] flush failed for ${provider || "unknown"}/${model || "unknown"}: ${error?.message || "unknown error"}`);
        finalizeStream();
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, onStreamFailure = null, apiKey = null, customToolNames = null, ensureOpenAIDone = false, credentials = null, onGuardFailure = null) {
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
    onStreamFailure,
    apiKey,
    ensureOpenAIDone,
    credentials,
    onGuardFailure
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, onStreamFailure = null, apiKey = null, targetFormat = null, sourceFormat = null, onGuardFailure = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    onStreamFailure,
    apiKey,
    onGuardFailure
  });
}
