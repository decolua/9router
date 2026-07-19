/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { buildChunk } from "../concerns/chunk.js";
import { buildUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta, extractReasoningText } from "../concerns/reasoning.js";
import {
  createResponsesAccumulator,
  finalizeResponsesAccumulator,
  getResponsesItems,
  reduceResponsesEvent,
  responsesItemText
} from "../concerns/responsesAccumulator.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index.js";

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
export function openaiToOpenAIResponsesResponse(chunk, state) {
  if (!chunk) {
    return flushEvents(state);
  }
  
  if (!chunk.choices?.length) return [];
  
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
    startReasoning(state, emit, idx);
    emitReasoningDelta(state, emit, reasoningText);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content;

    if (content.includes("<think>")) {
      state.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(state, emit, idx);
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
      return events;
    }

    if (content) {
      emitTextContent(state, emit, idx, content);
    }
  }

  // Handle tool_calls
  if (delta.tool_calls) {
    closeMessage(state, emit, idx);
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    for (const i in state.funcCallIds) closeToolCall(state, emit, i);
    sendCompleted(state, emit);
  }

  return events;
}

// Helper functions
function startReasoning(state, emit, idx) {
  if (!state.reasoningId) {
    state.reasoningId = `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = idx;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] }
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: idx,
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

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item: {
        id: state.reasoningId,
        type: RESPONSES_ITEM.REASONING,
        summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }]
      }
    });
  }
}

function emitTextContent(state, emit, idx, content) {
  if (!state.msgItemAdded[idx]) {
    state.msgItemAdded[idx] = true;
    const msgId = `msg_${state.responseId}_${idx}`;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT }
    });
  }

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;
    
    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: `msg_${state.responseId}_${idx}`,
      output_index: idx,
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: "" }
    });
  }

  emit("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: `msg_${state.responseId}_${idx}`,
    output_index: idx,
    content_index: 0,
    delta: content,
    logprobs: []
  });

  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
}

function closeMessage(state, emit, idx) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      text: fullText,
      logprobs: []
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: msgId,
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }],
        role: ROLE.ASSISTANT
      }
    });
  }
}

function emitToolCall(state, emit, tc) {
  const tcIdx = tc.index ?? 0;
  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (funcName) state.funcNames[tcIdx] = funcName;

  if (!state.funcCallIds[tcIdx] && newCallId) {
    state.funcCallIds[tcIdx] = newCallId;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: tcIdx,
      item: {
        id: `fc_${newCallId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: "",
        call_id: newCallId,
        name: state.funcNames[tcIdx] || ""
      }
    });
  }

  if (!state.funcArgsBuf[tcIdx]) state.funcArgsBuf[tcIdx] = "";

  if (tc.function?.arguments) {
    const refCallId = state.funcCallIds[tcIdx] || newCallId;
    if (refCallId) {
      emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${refCallId}`,
        output_index: tcIdx,
        delta: tc.function.arguments
      });
    }
    state.funcArgsBuf[tcIdx] += tc.function.arguments;
  }
}

function closeToolCall(state, emit, idx) {
  const callId = state.funcCallIds[idx];
  if (callId && !state.funcItemDone[idx]) {
    const args = state.funcArgsBuf[idx] || "{}";
    
    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: `fc_${callId}`,
      output_index: parseInt(idx),
      arguments: args
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: `fc_${callId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: args,
        call_id: callId,
        name: state.funcNames[idx] || ""
      }
    });

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

function sendCompleted(state, emit) {
  if (!state.completedSent) {
    state.completedSent = true;
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "completed",
        background: false,
        error: null
      }
    });
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
  for (const i in state.funcCallIds) closeToolCall(state, emit, i);
  sendCompleted(state, emit);
  
  return events;
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk, state) {
  const accumulator = ensureResponsesAccumulator(state);

  if (!chunk) {
    if (state.finishReasonSent) return null;
    finalizeResponsesAccumulator(accumulator, {
      error: {
        type: "stream_error",
        code: "stream_disconnected",
        message: "stream closed before a terminal response event"
      }
    });
    return finalizeResponsesChatStream(state, accumulator);
  }

  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
  }

  const reduced = reduceResponsesEvent(accumulator, chunk);
  if (!reduced.accepted) return null;

  const chunks = [];
  if (reduced.item?.type === RESPONSES_ITEM.MESSAGE) {
    chunks.push(...emitPendingItemText(state, accumulator, reduced.item, false));
  } else if (reduced.item?.type === RESPONSES_ITEM.REASONING) {
    // Raw reasoning may be followed by a canonical summary for the same item.
    // Defer raw text so an already-emitted prefix cannot make that summary
    // impossible to represent in the Chat reasoning field.
    if (reduced.type?.startsWith("response.reasoning_summary_")) {
      chunks.push(...emitPendingItemText(state, accumulator, reduced.item, true));
    }
  }

  if (accumulator.finalized) {
    chunks.push(...finalizeResponsesChatStream(state, accumulator));
  } else {
    chunks.push(...flushReadyTools(state, accumulator));
  }
  return chunks.length > 0 ? chunks : null;
}

function ensureResponsesAccumulator(state) {
  state.responsesAccumulator ??= createResponsesAccumulator({
    createdAt: state.created,
    model: state.model
  });
  state.responsesChatItems ??= new Map();
  state.responsesNextToolIndex ??= 0;
  state.responsesEmissionOrder ??= 0;
  return state.responsesAccumulator;
}

function chatMetadata(state, accumulator) {
  return {
    id: state.chatId || `chatcmpl-${Date.now()}`,
    created: accumulator.createdAt || state.created || Math.floor(Date.now() / 1000),
    model: accumulator.model || state.model || MODEL_FALLBACK
  };
}

function chatItemState(state, item) {
  const aliases = item.aliasOrders || new Set([item.order]);
  const existing = [...new Set([...aliases].map(order => state.responsesChatItems.get(order)).filter(Boolean))];
  let chatItem = existing.find(candidate => candidate.announced) || existing[0];
  if (!chatItem) {
    chatItem = { textFragments: [], argumentFragments: [], announced: false, nameSent: false, index: null };
  }
  for (const candidate of existing) {
    if (candidate === chatItem) continue;
    chatItem.textFragments.push(...candidate.textFragments);
    chatItem.argumentFragments.push(...candidate.argumentFragments);
    chatItem.announced ||= candidate.announced;
    chatItem.nameSent ||= candidate.nameSent;
    chatItem.index ??= candidate.index;
  }
  chatItem.textFragments = uniqueFragments(chatItem.textFragments);
  chatItem.argumentFragments = uniqueFragments(chatItem.argumentFragments);
  for (const order of aliases) state.responsesChatItems.set(order, chatItem);
  return chatItem;
}

function uniqueFragments(fragments) {
  return [...new Set(fragments)].sort((a, b) => a.order - b.order);
}

function emittedText(fragments) {
  return fragments.map(fragment => fragment.value).join("");
}

function completeReasoningText(item) {
  const summary = responsesItemText(item);
  if (summary) return summary;
  return [...item.content.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, part]) => typeof part.text === "string" ? part.text : "")
    .join("");
}

function emitPendingItemText(state, accumulator, item, reasoning) {
  const chatItem = chatItemState(state, item);
  const complete = reasoning ? completeReasoningText(item) : responsesItemText(item);
  const emitted = emittedText(chatItem.textFragments);
  if (!complete.startsWith(emitted)) return [];
  const delta = complete.slice(emitted.length);
  if (!delta) return [];
  chatItem.textFragments.push({ order: state.responsesEmissionOrder++, value: delta });
  return [buildChunk(
    chatMetadata(state, accumulator),
    reasoning ? reasoningDelta(delta) : { content: delta }
  )];
}

function isToolItem(item) {
  return item?.type === RESPONSES_ITEM.FUNCTION_CALL || item?.type === "custom_tool_call";
}

function isExecutableToolItem(item) {
  return isToolItem(item) && typeof item.name === "string" && item.name.trim() !== "";
}

function hasStableOutputOrder(items) {
  if (items.length === 0) return true;
  const indices = items.map(item => item.outputIndex);
  if (indices.every(index => index === null)) return true;
  if (indices.some(index => index === null)) return false;
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  return unique.length === items.length && unique.every((index, position) => index === position);
}

function emitPendingTool(state, accumulator, item, force = false) {
  const chatItem = chatItemState(state, item);
  const currentArguments = item.type === "custom_tool_call" ? item.input : item.arguments;
  const hasMetadata = Boolean(item.callId || item.name || (force && item.id));
  if (!chatItem.announced && !hasMetadata) return [];
  const emittedArguments = emittedText(chatItem.argumentFragments);
  if (!currentArguments.startsWith(emittedArguments)) return [];

  const argsDelta = currentArguments.slice(emittedArguments.length);
  const nameDelta = !chatItem.nameSent && item.name ? item.name : "";
  if (chatItem.announced && !argsDelta && !nameDelta) return [];

  if (chatItem.index === null) chatItem.index = state.responsesNextToolIndex++;
  const toolCall = {
    index: chatItem.index,
    function: { arguments: argsDelta }
  };
  if (!chatItem.announced) {
    item.callId ||= item.id || fallbackToolCallId(chatItem.index);
    toolCall.id = item.callId;
    toolCall.type = OPENAI_BLOCK.FUNCTION;
  }
  if (nameDelta) {
    toolCall.function.name = nameDelta;
    chatItem.nameSent = true;
  }

  chatItem.announced = true;
  if (argsDelta) {
    chatItem.argumentFragments.push({ order: state.responsesEmissionOrder++, value: argsDelta });
  }
  return [buildChunk(chatMetadata(state, accumulator), { tool_calls: [toolCall] })];
}

function flushReadyTools(state, accumulator, force = false) {
  const items = getResponsesItems(accumulator);
  const tools = items.filter(isToolItem);
  if (tools.length === 0) return [];

  // A currently contiguous prefix can still be invalidated by a later item.
  // Hold translated tools until the terminal event fixes the complete order.
  if (!force) return [];
  if (accumulator.outputOrderConflict || !hasStableOutputOrder(items)) return [];

  const chunks = [];
  for (const item of tools.filter(isExecutableToolItem)) {
    chunks.push(...emitPendingTool(state, accumulator, item, force));
  }
  return chunks;
}

function toChatUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens || usage.cache_read_input_tokens || 0;
  return buildUsage({
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: usage.total_tokens || inputTokens + outputTokens,
    cachedTokens
  });
}

function responseFinishReason(accumulator) {
  if (accumulator.terminalResponse?.status === "incomplete" &&
      accumulator.terminalResponse?.incomplete_details?.reason === "max_output_tokens") {
    return OPENAI_FINISH.LENGTH;
  }
  if (accumulator.terminalResponse?.status !== "completed") return OPENAI_FINISH.STOP;
  const items = getResponsesItems(accumulator);
  const tools = items.filter(isToolItem);
  return !accumulator.outputOrderConflict && hasStableOutputOrder(items) &&
    tools.length > 0 && tools.every(isExecutableToolItem)
    ? OPENAI_FINISH.TOOL_CALLS
    : OPENAI_FINISH.STOP;
}

function finalizeResponsesChatStream(state, accumulator) {
  if (state.finishReasonSent) return [];
  const chunks = [];
  for (const item of getResponsesItems(accumulator)) {
    if (item.type === RESPONSES_ITEM.MESSAGE) {
      chunks.push(...emitPendingItemText(state, accumulator, item, false));
    } else if (item.type === RESPONSES_ITEM.REASONING) {
      chunks.push(...emitPendingItemText(state, accumulator, item, true));
    }
  }
  chunks.push(...flushReadyTools(state, accumulator, true));

  const error = accumulator.terminalResponse?.error;
  const finishReason = responseFinishReason(accumulator);
  state.finishReasonSent = true;
  state.finishReason = finishReason;
  state.usage = toChatUsage(accumulator.terminalResponse?.usage || accumulator.usage);
  const finalDelta = error
    ? { content: `[Error] ${error.message || JSON.stringify(error)}` }
    : {};
  const finalChunk = buildChunk(chatMetadata(state, accumulator), finalDelta, finishReason);
  if (state.usage) finalChunk.usage = state.usage;
  chunks.push(finalChunk);
  return chunks;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
