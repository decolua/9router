/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { buildChunk } from "../concerns/chunk.js";
import { buildUsage } from "../concerns/usage.js";
import { responsesIncompleteToOpenAIFinish } from "../concerns/finishReason.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta, extractReasoningText } from "../concerns/reasoning.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index.js";

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
// Upstream Chat Completions usage -> Responses API usage shape.
// Without this, /v1/responses never reports usage: Responses clients (Codex CLI)
// keep their "context used" gauge pinned at 0 and never auto-compact, so a long
// session grows until the upstream context limit rejects it (9router issue #3432).
//
// Note this is stored under state.responsesUsage, NOT state.usage: state.usage is
// owned by the stream layer, which fills it with normalizeUsage()-shaped counts
// (prompt_tokens/prompt_tokens_details) and hands it to finalizeStream() for
// logging and cost accounting. Overwriting it with this shape silently drops
// cached/reasoning tokens from those stats.
function toResponsesUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = [usage.input_tokens, usage.prompt_tokens].find(Number.isInteger);
  const outputTokens = [usage.output_tokens, usage.completion_tokens].find(Number.isInteger);
  // Some upstreams attach zeroed placeholders to every chunk. Wait for real counts
  // so response.completed cannot freeze the placeholder before the usage trailer.
  if (inputTokens === undefined || outputTokens === undefined || inputTokens + outputTokens <= 0) {
    return null;
  }
  const responseUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens
  };
  const cachedTokens = [usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens].find(Number.isInteger);
  const reasoningTokens = [usage.output_tokens_details?.reasoning_tokens, usage.completion_tokens_details?.reasoning_tokens].find(Number.isInteger);
  if (Number.isInteger(cachedTokens)) responseUsage.input_tokens_details = { cached_tokens: cachedTokens };
  if (Number.isInteger(reasoningTokens)) responseUsage.output_tokens_details = { reasoning_tokens: reasoningTokens };

  return responseUsage;
}

export function openaiToOpenAIResponsesResponse(chunk, state) {
  if (!chunk) {
    return flushEvents(state);
  }

  // Capture usage before the choices guard: OpenAI may send it in a trailer
  // whose choices array is empty.
  const responseUsage = toResponsesUsage(chunk.usage);
  if (responseUsage) state.responsesUsage = responseUsage;

  if (!chunk.choices?.length) {
    return state.completionPending && state.responsesUsage ? flushEvents(state) : [];
  }

  const events = [];
  const nextSeq = () => ++state.seq;
  
  const emit = (eventType, data) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  const choice = chunk.choices[0];
  const idx = choice.index || 0;
  const delta = choice.delta || {};

  // Emit initial events
  if (!state.started) {
    state.started = true;
    state.responseId = chunk.id ? `resp_${chunk.id}` : state.responseId;
    
    emit("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress",
        background: false,
        error: null,
        output: []
      }
    });

    emit("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress"
      }
    });
  }

  // Handle reasoning across vendor shapes (reasoning_content / reasoning / reasoning_details)
  const reasoningText = extractReasoningText(delta);
  if (reasoningText) {
    startReasoning(state, emit);
    emitReasoningDelta(state, emit, reasoningText);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content;

    if (content.includes("<think>")) {
      state.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(state, emit);
    }

    if (content.includes("</think>")) {
      const parts = content.split("</think>");
      const thinkPart = parts[0];
      const textPart = parts.slice(1).join("</think>");
      if (thinkPart) emitReasoningDelta(state, emit, thinkPart);
      closeReasoning(state, emit);
      state.inThinking = false;
      content = textPart;
    }

    if (state.inThinking && content) {
      emitReasoningDelta(state, emit, content);
      content = "";
    }

    if (content) {
      // The answer starts, so thinking is over. Upstreams that send reasoning via
      // reasoning_content never emit "</think>", so close it here rather than at finish.
      closeReasoning(state, emit);
      emitMessageContent(state, emit, idx, content, RESPONSES_ITEM.OUTPUT_TEXT);
    }
  }

  if (isNonEmptyString(delta.refusal)) {
    closeReasoning(state, emit);
    emitMessageContent(state, emit, idx, delta.refusal, RESPONSES_ITEM.REFUSAL);
  }

  // Handle tool_calls (empty array is truthy; require a real call)
  if (delta.tool_calls && delta.tool_calls.length) {
    closeReasoning(state, emit);
    closeMessage(state, emit, idx);
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    closeToolCalls(state, emit);
    state.chatFinishReason = choice.finish_reason;
    // Upstreams report usage either on the finish chunk itself or on a trailing chunk
    // whose `choices` array is empty (OpenAI does the latter). Emitting
    // the terminal event here would freeze the payload before that trailing chunk
    // is parsed. When usage is not known yet we leave completion to flushEvents().
    //
    // That only holds on the direct openai:openai-responses route. When this converter
    // runs as the second hop of a pivot (Claude/Gemini/Kiro upstream), translateResponse()
    // drops the terminal null chunk before reaching us — the first hop returns null for
    // it, leaving nothing to iterate — so flushEvents() is never called and deferring
    // would swallow the terminal event entirely.
    const flushReachesUs = state.targetFormat === FORMATS.OPENAI;
    if (state.responsesUsage || !flushReachesUs) sendChatFinish(state, emit);
    else state.completionPending = true;
  }

  return events;
}

// Helper functions
function nextOutputIndex(state) {
  const index = state.nextOutputIndex ?? 0;
  state.nextOutputIndex = index + 1;
  return index;
}

function messageOutputIndex(state, idx) {
  state.msgOutputIndices ??= {};
  return state.msgOutputIndices[idx] ??= nextOutputIndex(state);
}

function toolOutputIndex(state, idx) {
  state.funcOutputIndices ??= {};
  return state.funcOutputIndices[idx] ??= nextOutputIndex(state);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCompletedToolCall(state) {
  return Object.keys(state.funcItemAdded || {}).some(idx =>
    state.funcItemAdded[idx] &&
    state.funcItemDone?.[idx] &&
    isNonEmptyString(state.funcCallIds?.[idx]) &&
    isNonEmptyString(state.funcNames?.[idx])
  );
}

function hasIncompleteToolCall(state) {
  return [...(state.seenFuncIndices || [])].some(idx =>
    !isNonEmptyString(state.funcCallIds?.[idx]) || !isNonEmptyString(state.funcNames?.[idx])
  );
}

function hasAssistantOutput(state) {
  const hasText = state.assistantTextSeen || Object.values(state.msgTextBuf || {}).some(text =>
    isNonEmptyString(text)
  );
  return hasText || hasCompletedToolCall(state);
}

function startReasoning(state, emit) {
  if (!state.reasoningId || state.reasoningDone) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    state.reasoningIndex = nextOutputIndex(state);
    state.reasoningId = `rs_${state.responseId}_${state.reasoningIndex}`;
    state.reasoningBuf = "";
    state.reasoningDone = false;
    state.reasoningPartAdded = false;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: state.reasoningIndex,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] }
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: "" }
    });
    state.reasoningPartAdded = true;
  }
}

function emitReasoningDelta(state, emit, text) {
  if (!text) return;
  state.reasoningBuf += text;
  emit("response.reasoning_summary_text.delta", {
    type: "response.reasoning_summary_text.delta",
    item_id: state.reasoningId,
    output_index: state.reasoningIndex,
    summary_index: 0,
    delta: text
  });
}

function closeReasoning(state, emit) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;
    
    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }
    });

    const item = {
      id: state.reasoningId,
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }]
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item
    });

    recordCompletedOutputItem(state, state.reasoningIndex, item);
  }
}

function messageContentPart(kind, value) {
  return kind === RESPONSES_ITEM.REFUSAL
    ? { type: RESPONSES_ITEM.REFUSAL, refusal: value }
    : { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: value };
}

function emitMessageContent(state, emit, idx, content, kind) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]
    && state.msgContentKind?.[idx] !== kind) {
    closeMessage(state, emit, idx);
  }
  if (state.msgItemDone[idx]) {
    state.msgItemAdded[idx] = false;
    state.msgContentAdded[idx] = false;
    state.msgItemDone[idx] = false;
    state.msgTextBuf[idx] = "";
    delete state.msgOutputIndices[idx];
  }
  state.msgContentKind ??= {};
  state.msgContentKind[idx] = kind;
  const outputIndex = messageOutputIndex(state, idx);
  const msgId = `msg_${state.responseId}_${outputIndex}`;
  if (!state.msgItemAdded[idx]) {
    state.msgItemAdded[idx] = true;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT }
    });
  }

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;
    
    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part: messageContentPart(kind, "")
    });
  }

  const deltaEvent = kind === RESPONSES_ITEM.REFUSAL ? "response.refusal.delta" : "response.output_text.delta";
  emit(deltaEvent, {
    type: deltaEvent,
    item_id: msgId,
    output_index: outputIndex,
    content_index: 0,
    delta: content,
    ...(kind === RESPONSES_ITEM.OUTPUT_TEXT ? { logprobs: [] } : {})
  });

  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
  if (isNonEmptyString(content)) state.assistantTextSeen = true;
}

function closeMessage(state, emit, idx) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const outputIndex = messageOutputIndex(state, idx);
    const msgId = `msg_${state.responseId}_${outputIndex}`;
    const kind = state.msgContentKind?.[idx] || RESPONSES_ITEM.OUTPUT_TEXT;
    const part = messageContentPart(kind, fullText);

    const doneEvent = kind === RESPONSES_ITEM.REFUSAL ? "response.refusal.done" : "response.output_text.done";
    emit(doneEvent, {
      type: doneEvent,
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      ...(kind === RESPONSES_ITEM.REFUSAL
        ? { refusal: fullText }
        : { text: fullText, logprobs: [] })
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part
    });

    const item = {
      id: msgId,
      type: RESPONSES_ITEM.MESSAGE,
      content: [part],
      role: ROLE.ASSISTANT
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item
    });

    recordCompletedOutputItem(state, outputIndex, item);
  }
}

function isCustomTool(state, name) {
  return !!name && state.customToolNames?.has(name);
}

function extractCustomToolInput(argumentsText) {
  if (typeof argumentsText !== "string") return "";
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* incomplete or raw freeform input */ }
  return argumentsText;
}

function emitToolCall(state, emit, tc) {
  const tcIdx = tc.index ?? 0;
  state.seenFuncIndices ??= new Set();
  state.seenFuncIndices.add(tcIdx);
  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (isNonEmptyString(funcName)) state.funcNames[tcIdx] = funcName;
  if (isNonEmptyString(newCallId)) state.funcCallIds[tcIdx] = newCallId;

  // Some compatible providers split the call id and function name across
  // chunks. Wait for both before deciding whether this is a custom tool;
  // otherwise an `exec` call can be irreversibly announced as function_call.
  const callId = state.funcCallIds[tcIdx];
  if (!state.funcItemAdded[tcIdx] && isNonEmptyString(callId) && isNonEmptyString(state.funcNames[tcIdx])) {
    state.funcItemAdded[tcIdx] = true;
    const custom = isCustomTool(state, state.funcNames[tcIdx]);
    const outputIndex = toolOutputIndex(state, tcIdx);

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        id: `${custom ? "ctc" : "fc"}_${callId}`,
        type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
        ...(custom ? { input: "" } : { arguments: "" }),
        call_id: callId,
        name: state.funcNames[tcIdx] || ""
      }
    });
  }

  if (!state.funcArgsBuf[tcIdx]) state.funcArgsBuf[tcIdx] = "";

  if (tc.function?.arguments) {
    const refCallId = state.funcCallIds[tcIdx] || newCallId;
    if (state.funcItemAdded[tcIdx] && refCallId && !isCustomTool(state, state.funcNames[tcIdx])) {
      emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${refCallId}`,
        output_index: toolOutputIndex(state, tcIdx),
        delta: tc.function.arguments
      });
    }
    // Custom input is emitted once at close, after the Chat JSON wrapper can be
    // parsed and unwrapped. Streaming the raw JSON fragments would expose
    // {"input":"..."} instead of the freeform program Codex expects.
    state.funcArgsBuf[tcIdx] += tc.function.arguments;
  }
}

function closeToolCall(state, emit, idx) {
  const callId = state.funcCallIds[idx];
  if (callId && state.funcItemAdded?.[idx] && !state.funcItemDone[idx]) {
    const args = state.funcArgsBuf[idx] || "{}";
    const custom = isCustomTool(state, state.funcNames[idx]);
    const outputIndex = toolOutputIndex(state, idx);

    if (custom) {
      const input = extractCustomToolInput(args);
      emit("response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        item_id: `ctc_${callId}`,
        output_index: outputIndex,
        delta: input
      });
      emit("response.custom_tool_call_input.done", {
        type: "response.custom_tool_call_input.done",
        item_id: `ctc_${callId}`,
        output_index: outputIndex,
        input
      });
    } else {
      emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: `fc_${callId}`,
        output_index: outputIndex,
        arguments: args
      });
    }

    const item = {
      id: `${custom ? "ctc" : "fc"}_${callId}`,
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      ...(custom ? { input: extractCustomToolInput(args) } : { arguments: args }),
      call_id: callId,
      name: state.funcNames[idx] || ""
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item
    });

    recordCompletedOutputItem(state, outputIndex, item);

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

// response.completed carries the finished Response object, so response.output has
// to repeat the items already delivered in response.output_item.done. Clients that
// build their final result from the terminal event (GitHub Copilot CLI, the OpenAI
// SDK "final response" helpers) otherwise treat the turn as empty even though the
// text was streamed - see issue #4307.
//
// Keyed by output_index so a repeated close overwrites rather than duplicating the
// item, and ordered by output_index so response.output matches the order the items
// were emitted in. Lazily created because stream.js can hand us a state it built
// itself rather than one from initState().
function recordCompletedOutputItem(state, outputIndex, item) {
  state.completedOutputItems ??= new Map();
  const index = Number.isInteger(outputIndex) ? outputIndex : Number.parseInt(outputIndex, 10) || 0;
  state.completedOutputItems.set(index, item);
}

function collectCompletedOutputItems(state) {
  const recorded = state.completedOutputItems;
  if (!(recorded instanceof Map) || recorded.size === 0) return [];
  return [...recorded.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, item]) => item);
}

function closeToolCalls(state, emit) {
  const indices = Object.keys(state.funcCallIds).sort((a, b) =>
    (state.funcOutputIndices?.[a] ?? Number.MAX_SAFE_INTEGER) -
    (state.funcOutputIndices?.[b] ?? Number.MAX_SAFE_INTEGER)
  );
  for (const idx of indices) closeToolCall(state, emit, idx);
}

function sendTerminal(state, emit, status, responseFields = {}) {
  if (!state.completedSent) {
    state.completedSent = true;
    const eventType = `response.${status}`;
    emit(eventType, {
      type: eventType,
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status,
        background: false,
        error: null,
        output: collectCompletedOutputItems(state),
        ...(state.responsesUsage ? { usage: state.responsesUsage } : {}),
        ...responseFields
      }
    });
  }
}

function sendCompleted(state, emit) {
  sendTerminal(state, emit, "completed");
}

function sendIncomplete(state, emit, reason) {
  sendTerminal(state, emit, "incomplete", {
    incomplete_details: { reason }
  });
}

function sendFailed(state, emit, error = {
  type: "stream_error",
  code: "stream_disconnected",
  message: "stream closed before finish_reason"
}) {
  sendTerminal(state, emit, "failed", {
    error
  });
}

function sendChatFinish(state, emit) {
  const finishReason = state.chatFinishReason === "other" && hasCompletedToolCall(state)
    ? OPENAI_FINISH.TOOL_CALLS
    : state.chatFinishReason;
  if (finishReason === OPENAI_FINISH.LENGTH) {
    sendIncomplete(state, emit, "max_output_tokens");
  } else if (finishReason === OPENAI_FINISH.CONTENT_FILTER) {
    sendIncomplete(state, emit, "content_filter");
  } else if (finishReason !== OPENAI_FINISH.STOP && finishReason !== OPENAI_FINISH.TOOL_CALLS) {
    sendFailed(state, emit, {
      type: "upstream_error",
      code: "invalid_finish_reason",
      message: "upstream returned an unsupported finish_reason"
    });
  } else if (!hasAssistantOutput(state)) {
    sendFailed(state, emit, {
      type: "upstream_error",
      code: "empty_output",
      message: "upstream finished without assistant text or a tool call"
    });
  } else if (hasIncompleteToolCall(state)) {
    sendFailed(state, emit, {
      type: "upstream_error",
      code: "invalid_tool_call",
      message: "upstream returned a tool call without a valid ID or name"
    });
  } else {
    sendCompleted(state, emit);
  }
}

function flushEvents(state) {
  if (state.completedSent) return [];
  
  const events = [];
  const nextSeq = () => ++state.seq;
  const emit = (eventType, data) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  for (const i in state.msgItemAdded) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  closeToolCalls(state, emit);
  if (state.chatFinishReason) sendChatFinish(state, emit);
  else sendFailed(state, emit);
  
  return events;
}

// currentToolCallId is intentionally sticky for the current turn so flush/completion
  // can still finalize as tool_calls even if the tool call was emitted before stream end.
function computeFinishReason(state) {
   return state.toolCallIndex > 0 || state.currentToolCallId
    ? OPENAI_FINISH.TOOL_CALLS
    : OPENAI_FINISH.STOP;
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk, state) {
  if (!chunk) {
    // Flush: send final chunk with finish_reason
    if (state.finishReasonSent || !state.started) return null;

    const finishReason = computeFinishReason(state);

    state.finishReasonSent = true;
    state.finishReason = finishReason;

    const finalChunk = buildChunk(
      { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
      {},
      finishReason
    );

    if (state.usage && typeof state.usage === "object") {
      finalChunk.usage = state.usage;
    }

    return finalChunk;
  }

  // Handle different event types from Responses API
  const eventType = chunk.type || chunk.event;
  const data = chunk.data || chunk;

  // Initialize state
  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolCallIndex = 0;
    state.currentToolCallId = null;
    // item_id → chat tool_calls index. Deltas carry item_id; keying on it (not
    // stream position) keeps parallel calls separate when upstream emits all
    // output_item.added events before any done/delta. Lazily created so callers
    // that build their own state object (stream.js) need no changes.
    state.respToolChatIndex ??= new Map();
    // Indices that already received argument deltas (guards done-with-args).
    state.respToolArgsEmitted ??= new Set();
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { content: delta }
    );
  }

  if (eventType === "response.refusal.delta") {
    const delta = data.delta || "";
    if (!delta) return null;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { refusal: delta }
    );
  }

  // Text content done (ignore, we handle via delta)
  if (eventType === "response.output_text.done") {
    return null;
  }

  // Function call started (standard function_call or custom_tool_call).
  // Index is assigned here (not on done): attributing deltas by stream position
  // merges parallel calls into index 0 whenever upstream emits all addeds
  // before dones — the client then concatenates N JSON payloads into one
  // tool input and fails validation. The server item id is the correlator.
  if (eventType === "response.output_item.added" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const item = data.item;
    state.currentToolCallId = item.call_id || fallbackToolCallId();
    state.respToolChatIndex ??= new Map();
    const key = item.id || data.item_id || state.currentToolCallId;
    let idx;
    if (key && state.respToolChatIndex.has(key)) {
      idx = state.respToolChatIndex.get(key); // duplicate added (retry) — reuse
    } else {
      idx = state.toolCallIndex++;
      if (key) state.respToolChatIndex.set(key, idx);
    }

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      {
        tool_calls: [{
          index: idx,
          id: state.currentToolCallId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: item.name || "", arguments: "" }
        }]
      }
    );
  }

  // Function call arguments delta (standard or custom_tool_call variant).
  // Routed by item_id so interleaved parallel fragments stay on their own call.
  if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    const known = data.item_id ? state.respToolChatIndex?.get(data.item_id) : undefined;
    const idx = known ?? Math.max(0, (state.toolCallIndex || 1) - 1);
    state.respToolArgsEmitted ??= new Set();
    state.respToolArgsEmitted.add(idx);
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { tool_calls: [{ index: idx, function: { arguments: argsDelta } }] }
    );
  }

  // Function call done (standard or custom_tool_call variant).
  // Index was assigned at added-time; nothing to advance. Some upstreams send
  // complete arguments only here (no deltas) — emit them once in that case.
  if (eventType === "response.output_item.done" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const key = data.item?.id || data.item_id;
    const idx = (key && state.respToolChatIndex?.get(key)) ?? Math.max(0, (state.toolCallIndex || 1) - 1);
    const fullArgs = data.item?.arguments;
    if (typeof fullArgs === "string" && fullArgs) {
      state.respToolArgsEmitted ??= new Set();
      if (!state.respToolArgsEmitted.has(idx)) {
        state.respToolArgsEmitted.add(idx);
        return buildChunk(
          { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
          { tool_calls: [{ index: idx, function: { arguments: fullArgs } }] }
        );
      }
    }
    return null;
  }

  // A response.done event can carry a failed status. Handle it with the
  // explicit failure events before the completion branch computes a finish reason.
  if (eventType === "error" || eventType === "response.failed"
    || (eventType === "response.done" && data.response?.status === "failed")) {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (state.finishReasonSent) return null;

    const error = data.error || data.response?.error || {
      type: "stream_error",
      message: "upstream Responses stream failed"
    };
    state.error = error;
    state.finishReasonSent = true;

    // Preserve the Chat chunk for pivot translations while giving OpenAI SSE
    // clients a top-level error they can treat as a failed request.
    const errorChunk = buildChunk(
      { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
      { content: `[Error] ${error.message || JSON.stringify(error)}` },
      OPENAI_FINISH.STOP
    );
    errorChunk.error = error;
    return errorChunk;
  }

  // Response completed
  if (eventType === "response.completed" || eventType === "response.done" || eventType === "response.incomplete") {
    // Extract usage from response.completed event
    const responseUsage = data.response?.usage;
    if (responseUsage && typeof responseUsage === "object") {
      const inputTokens = responseUsage.input_tokens || responseUsage.prompt_tokens || 0;
      const outputTokens = responseUsage.output_tokens || responseUsage.completion_tokens || 0;
      // OpenAI Responses API: input_tokens already includes cached_tokens
      // Cache info is in input_tokens_details.cached_tokens
      const cacheReadTokens = responseUsage.input_tokens_details?.cached_tokens || responseUsage.cache_read_input_tokens || 0;
      
      state.usage = buildUsage({ promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens: cacheReadTokens });
    }
    
    if (!state.finishReasonSent) {
      const incomplete = eventType === "response.incomplete" || data.response?.status === "incomplete";
      const finishReason = incomplete
        ? responsesIncompleteToOpenAIFinish(data.response?.incomplete_details?.reason)
        : computeFinishReason(state);

      state.finishReasonSent = true;
      state.finishReason = finishReason; // Mark for usage injection in stream.js
      
      const finalChunk = buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        {},
        finishReason
      );

      // Include usage in final chunk if available
      if (state.usage && typeof state.usage === "object") {
        finalChunk.usage = state.usage;
      }
      
      return finalChunk;
    }
    return null;
  }

  // Reasoning summary delta → emit as reasoning_content for client thinking display
  if (eventType === "response.reasoning_summary_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      reasoningDelta(delta)
    );
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
