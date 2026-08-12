/**
 * Gemini → Claude Response Translator (DIRECT route, no OpenAI pivot)
 *
 * The counterpart to request/claude-to-gemini.js. The pivot route sends Gemini
 * candidates through gemini-to-openai and then openai-to-claude, which means two
 * rebuilds of block structure and tool-call identity for a pair that is fragile
 * in exactly those places.
 *
 * Gemini delivers a functionCall whole rather than as argument fragments, so
 * there is no partial-JSON accumulation here and none of the doubling that the
 * openai-compat path has to defend against.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
// Shared rather than copied: duplicating these filters is how they came to be
// missing from two of three response paths.
import { filterEchoText, filterUserEcho, flushEchoText } from "./openai-to-claude.js";

function stopBlock(state, results, key, indexKey) {
  if (!state[key]) return;
  results.push({ type: "content_block_stop", index: state[indexKey] });
  state[key] = false;
}

const stopThinking = (state, results) => stopBlock(state, results, "thinkingBlockStarted", "thinkingBlockIndex");
const stopText = (state, results) => stopBlock(state, results, "textBlockStarted", "textBlockIndex");

function convertFinishReason(reason) {
  switch (reason) {
    case "STOP": return "end_turn";
    case "MAX_TOKENS": return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT": return "stop_sequence";
    default: return "end_turn";
  }
}

/**
 * One Gemini stream chunk → an array of Claude SSE events (or null).
 */
export function geminiToClaudeResponse(chunk, state) {
  let data = chunk;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "[DONE]") return null;
    try {
      data = JSON.parse(trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;

  // gemini-cli and antigravity wrap the payload; the plain API does not.
  const payload = data.response || data;
  const candidate = payload.candidates?.[0];
  const results = [];

  const usage = payload.usageMetadata;
  if (usage && typeof usage === "object") {
    state.usage = {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    };
  }

  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = `msg_${Date.now()}`;
    state.model = payload.modelVersion || state.model || "gemini";
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.usage?.input_tokens || 0, output_tokens: 0 },
      },
    });
  }

  for (const part of candidate?.content?.parts || []) {
    if (!part || typeof part !== "object") continue;

    // Reasoning. Never echo-filtered: reasoning legitimately opens mid-thought,
    // and judging it would delete real thinking.
    if (part.thought === true && typeof part.text === "string" && part.text) {
      stopText(state, results);
      if (!state.thinkingBlockStarted) {
        state.thinkingBlockIndex = state.nextBlockIndex++;
        state.thinkingBlockStarted = true;
        results.push({
          type: "content_block_start",
          index: state.thinkingBlockIndex,
          content_block: { type: "thinking", thinking: "" },
        });
      }
      results.push({
        type: "content_block_delta",
        index: state.thinkingBlockIndex,
        delta: { type: "thinking_delta", thinking: part.text },
      });
      continue;
    }

    if (part.functionCall) {
      stopThinking(state, results);
      stopText(state, results);
      const index = state.nextBlockIndex++;
      const call = part.functionCall;
      results.push({
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: call.id || `toolu_${Date.now()}_${index}`,
          name: call.name || "",
          input: {},
        },
      });
      // Gemini hands over complete arguments, so this is one delta, not a
      // reassembled fragment stream.
      results.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(call.args ?? {}) },
      });
      results.push({ type: "content_block_stop", index });
      state.sawToolUse = true;
      continue;
    }

    if (typeof part.text === "string" && part.text) {
      const filtered = filterUserEcho(state, filterEchoText(state, part.text));
      if (!filtered) continue;
      stopThinking(state, results);
      if (!state.textBlockStarted) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockStarted = true;
        results.push({
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" },
        });
      }
      results.push({
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: filtered },
      });
    }
  }

  if (candidate?.finishReason) {
    // filterEchoText parks a possible split-tag tail in state.echoCarry. Without
    // this flush a reply ending in "<" — or in any prefix of a harness tag — has
    // those characters silently dropped.
    const tail = flushEchoText(state);
    if (tail && state.textBlockStarted) {
      results.push({
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: tail },
      });
    }
    stopThinking(state, results);
    stopText(state, results);
    results.push({
      type: "message_delta",
      delta: {
        stop_reason: state.sawToolUse ? "tool_use" : convertFinishReason(candidate.finishReason),
        stop_sequence: null,
      },
      usage: { output_tokens: state.usage?.output_tokens || 0 },
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.GEMINI, FORMATS.CLAUDE, null, geminiToClaudeResponse);
