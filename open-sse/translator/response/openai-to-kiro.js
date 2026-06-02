/**
 * OpenAI to Kiro Response Translator
 * Converts OpenAI SSE chat.completion.chunk objects to AWS EventStream binary frames
 *
 * Reverse of kiro-to-openai.js
 */
import { EventStreamCodec } from "@smithy/eventstream-codec";
import { toUtf8, fromUtf8 } from "@smithy/util-utf8";
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

const codec = new EventStreamCodec(toUtf8, fromUtf8);

/**
 * Encode a Kiro event as an AWS EventStream binary frame
 */
function encodeEventStream(eventType, payload) {
  return codec.encode({
    headers: {
      ":message-type": { type: "string", value: "event" },
      ":event-type": { type: "string", value: eventType },
      ":content-type": { type: "string", value: "application/json" }
    },
    body: fromUtf8(JSON.stringify(payload))
  });
}

/**
 * Initialize state for the Kiro response translator
 */
export function initKiroState() {
  return {
    modelId: null,       // Model name from first chunk (included in every content frame)
    toolCallInit: {},    // { [index]: { id, name } } — first frame emitted, tracks seen tools
    hasToolCalls: false, // Whether this response uses tool calls (affects termination)
    finishSent: false,   // Whether termination has been emitted
    usage: null,         // Accumulated usage from usage-only chunks
    inThink: false,      // Whether inside a <thinking>/<think> block across chunks
    thinkBuf: ""         // Buffer for partial thinking content
  };
}

/**
 * Extract thinking blocks from text content.
 * Handles both <thinking>...</thinking> and <think>...</think> tags,
 * including partial tags split across SSE chunks.
 */
function extractThinking(text, state) {
  if (!text) return { thinking: null, text: null };

  let working = text;

  // Prepend buffered partial thinking from previous chunk
  if (state.inThink && state.thinkBuf) {
    working = state.thinkBuf + working;
    state.thinkBuf = "";
    state.inThink = false;
  }

  // Match <thinking> or <think> opening tags
  const startRe = /<thinking>|<think>/i;
  const startMatch = working.match(startRe);

  if (!startMatch) {
    return { thinking: null, text: working };
  }

  const tag = startMatch[0].toLowerCase();
  const closeTag = tag === "<think>" ? "</think>" : "</thinking>";
  const startIdx = startMatch.index;
  const endIdx = working.indexOf(closeTag, startIdx + tag.length);

  if (endIdx === -1) {
    // Opening tag without closing — buffer for next chunk
    state.inThink = true;
    state.thinkBuf = working.slice(startIdx);
    const before = working.slice(0, startIdx).trim();
    return { thinking: null, text: before || null };
  }

  // Complete block found
  const thinking = working.slice(startIdx + tag.length, endIdx);
  const before = working.slice(0, startIdx).trim();
  const after = working.slice(endIdx + closeTag.length).trim();
  const rest = [before, after].filter(Boolean).join("");

  // Recursively process for more blocks
  const recurse = rest
    ? extractThinking(rest, { inThink: false, thinkBuf: "" })
    : { thinking: null, text: null };

  return {
    thinking: thinking || null,
    text: recurse.text || null
  };
}

/**
 * Emit termination frames. For tool-call responses, emits stop:true per tool.
 * For text-only responses, emits messageStopEvent.
 */
function emitFinish(state) {
  const frames = [];

  if (state.hasToolCalls) {
    // Tool-call response: emit stop:true for each tool
    for (const idx of Object.keys(state.toolCallInit).sort()) {
      const tc = state.toolCallInit[idx];
      frames.push(encodeEventStream("toolUseEvent", {
        name: tc.name,
        stop: true,
        toolUseId: tc.id
      }));
    }
  } else {
    // Text-only response: emit messageStopEvent
    frames.push(encodeEventStream("messageStopEvent", {}));
  }
  state.finishSent = true;

  // Emit usage if available
  if (state.usage) {
    frames.push(encodeEventStream("usageEvent", {
      inputTokens: state.usage.prompt_tokens || 0,
      outputTokens: state.usage.completion_tokens || 0
    }));
  }

  state.toolCallInit = {};
  return frames.length > 0 ? frames : null;
}

/**
 * Convert an OpenAI SSE chunk to AWS EventStream binary frame(s)
 *
 * @param {object|null} chunk - Parsed OpenAI chat.completion.chunk, or null for flush
 * @param {object} state - Mutable state object from initKiroState()
 * @returns {Uint8Array|Uint8Array[]|null} Binary EventStream frame(s) or null to skip
 */
export function convertOpenAIToKiro(chunk, state) {
  // Flush: ensure clean stream termination
  if (!chunk) {
    if (state.finishSent) return null;
    // Flush any remaining buffered thinking
    if (state.inThink && state.thinkBuf) {
      state.inThink = false;
      const thinking = state.thinkBuf;
      state.thinkBuf = "";
      return encodeEventStream("reasoningContentEvent", {
        content: thinking,
        modelId: state.modelId || ""
      });
    }
    return encodeEventStream("messageStopEvent", {});
  }

  const frames = [];
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};

  // Capture modelId from first chunk (real API includes it in every content frame)
  if (!state.modelId && chunk.model) {
    state.modelId = chunk.model;
  }
  const modelId = state.modelId || "";

  // Handle usage (may arrive standalone or with other chunks)
  if (chunk.usage) {
    state.usage = chunk.usage;
  }

  // Handle tool calls — stream incrementally, matching real API format:
  // Frame 1: {name, toolUseId}  (first appearance, no input)
  // Frame N: {input: "<fragment>", name, toolUseId}  (incremental arg fragments)
  // Frame final: {name, stop: true, toolUseId}  (completion, emitted in emitFinish)
  if (delta.tool_calls) {
    state.hasToolCalls = true;
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      if (tc.id && tc.function?.name && !state.toolCallInit[idx]) {
        // First appearance: emit frame with name + id, no input
        state.toolCallInit[idx] = { id: tc.id, name: tc.function.name };
        frames.push(encodeEventStream("toolUseEvent", {
          name: tc.function.name,
          toolUseId: tc.id
        }));
      }

      // Emit incremental input fragment
      if (tc.function?.arguments) {
        const init = state.toolCallInit[idx];
        frames.push(encodeEventStream("toolUseEvent", {
          input: tc.function.arguments,
          name: init?.name || tc.function?.name || "",
          toolUseId: init?.id || tc.id || ""
        }));
      }
    }
  }

  // Handle explicit reasoning_content (type-specific thinking channel)
  if (delta.reasoning_content) {
    frames.push(encodeEventStream("reasoningContentEvent", {
      content: delta.reasoning_content,
      modelId
    }));
  }

  // Handle text content — extract thinking blocks, emit rest as assistantResponseEvent
  if (delta.content) {
    const { thinking, text } = extractThinking(delta.content, state);

    if (thinking) {
      frames.push(encodeEventStream("reasoningContentEvent", {
        content: thinking,
        modelId
      }));
    }

    if (text) {
      frames.push(encodeEventStream("assistantResponseEvent", {
        content: text,
        modelId
      }));
    }
  }

  // Handle finish_reason
  if (choice?.finish_reason) {
    const finishFrames = emitFinish(state);
    if (finishFrames) {
      frames.push(...(Array.isArray(finishFrames) ? finishFrames : [finishFrames]));
    }
  }

  if (frames.length === 0) return null;
  return frames.length === 1 ? frames[0] : frames;
}

register(FORMATS.OPENAI, FORMATS.KIRO, null, convertOpenAIToKiro);