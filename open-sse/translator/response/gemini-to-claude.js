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
 * True once anything the client can render has been opened.
 *
 * Gemini omits `content.parts` entirely when it blocks a candidate, so a
 * SAFETY/RECITATION finish arrives with a finishReason and nothing else. The
 * part loop then iterates zero times while the finish branch still emits
 * message_delta + message_stop, producing a well-formed Claude message with an
 * empty content array.
 *
 * Claude Code renders nothing for that, persists no assistant entry, and
 * injects "[Your previous response had no visible output. Please continue...]"
 * — which goes back upstream and blocks again. That is a livelock, not a
 * refusal: 238 occurrences of that marker across ~/.claude/projects, and in
 * session 595d1ac8 the user sent 10 messages into the silence before giving up.
 * The echo filters below are a second route to the same state: if
 * filterUserEcho eats every part, no block is ever opened either.
 */
function hasRenderableContent(state) {
  return Boolean(state.textBlockStarted || state.thinkingBlockStarted || state.sawToolUse);
}

/**
 * A visible text block describing why the turn is empty.
 *
 * Deliberately user-visible rather than logged: the client only breaks its
 * retry loop when it receives something it can render, so the diagnosis has to
 * travel in-band. It is also read by the model, hence the explicit next step.
 */
function emitEmptyTurnNotice(state, results, candidate, payload, raw) {
  const finish = candidate?.finishReason || "none";
  const block = payload?.promptFeedback?.blockReason;
  const ratings = (candidate?.safetyRatings || [])
    .filter((r) => r && r.blocked)
    .map((r) => r.category)
    .join(", ");

  let text = `[9router] ${state.model || "upstream"} returned a response with no content `
    + `(finishReason=${finish}`;
  if (block) text += `, promptFeedback.blockReason=${block}`;
  if (ratings) text += `, blocked=${ratings}`;
  text += ").";

  if (finish === "MALFORMED_FUNCTION_CALL") {
    text += " The model emitted an unparseable tool call. Retry the same request;"
      + " if it repeats, make the tool arguments simpler.";
  } else if (finish !== "STOP" && finish !== "none") {
    text += " This is a provider-side block, not a tool or network failure."
      + " Rephrase the request, or switch to another model — repeating it"
      + " verbatim will be blocked again.";
  } else {
    text += " The stream closed before emitting any content.";
  }

  // A quota-exhausted or down provider answers with an HTML/plain-text error
  // page rather than JSON. Swallowing it is how a 429 became silence instead of
  // a failover, so the body travels with the notice.
  if (raw) {
    text += `\n\nUpstream sent an unparseable body: ${String(raw).replace(/\s+/g, " ").slice(0, 400)}`;
  }

  const index = state.nextBlockIndex++;
  state.textBlockIndex = index;
  state.textBlockStarted = true;
  state.emptyTurn = true; // read by the caller to score this as an upstream failure
  results.push({
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  });
  results.push({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  });
}

/**
 * One Gemini stream chunk → an array of Claude SSE events (or null).
 */
/**
 * Close the stream, guaranteeing the client receives something renderable.
 *
 * Every terminator routes through here. Previously `[DONE]`, an unparseable
 * body, and a non-object chunk each returned null on their own, so a stream
 * that ended any of those ways emitted no `message_stop` at all — a dangling
 * message, which the client also reports as "no visible output".
 *
 * A stream that never sent `message_start` is left alone: a terminator arriving
 * on a virgin state is a stray frame, not a truncated turn, and fabricating a
 * message for it would inject a phantom turn into a well-formed flow. The
 * HTTP-level version of that failure — a 429/502 whose whole body is an error
 * page — never reaches this translator anyway; `preflightSseResponse` in
 * services/combo.js judges it by status before any byte is forwarded and
 * cascades to the next combo member.
 */
function finishStream(state, raw) {
  if (state.finishHandled || !state.messageStartSent) return null;
  state.finishHandled = true;
  const results = [];

  const tail = flushEchoText(state);
  if (tail && state.textBlockStarted) {
    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: tail },
    });
  }
  if (!hasRenderableContent(state)) {
    emitEmptyTurnNotice(state, results, null, null, raw);
  }
  stopThinking(state, results);
  stopText(state, results);
  results.push({
    type: "message_delta",
    delta: { stop_reason: state.sawToolUse ? "tool_use" : "end_turn", stop_sequence: null },
  });
  results.push({ type: "message_stop" });
  return results;
}

export function geminiToClaudeResponse(chunk, state) {
  let data = chunk;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (!trimmed) return null;
    const body = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (body === "[DONE]") return finishStream(state, null);
    try {
      data = JSON.parse(body);
    } catch {
      // Not JSON. A gateway 429/502 arrives exactly like this, and dropping it
      // is what turned a rate limit into silence.
      return finishStream(state, body);
    }
  }
  if (!data || typeof data !== "object") {
    return finishStream(state, null);
  }

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
    // A blocked candidate carries a finishReason and no parts, so nothing above
    // opened a block. Emitting message_stop now would hand the client an empty
    // message and start the retry livelock — say what happened instead.
    if (!hasRenderableContent(state)) {
      emitEmptyTurnNotice(state, results, candidate, payload);
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
register(FORMATS.GEMINI_CLI, FORMATS.CLAUDE, null, geminiToClaudeResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, geminiToClaudeResponse);
register(FORMATS.VERTEX, FORMATS.CLAUDE, null, geminiToClaudeResponse);
