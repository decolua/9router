// Detect a streamed completion that finished without ever producing usable
// content, so handleComboChat can fall through to the next candidate instead of
// returning a 200 that carries nothing.
//
// Why this exists: Gemini aborts a generation with finishReason MALFORMED_FUNCTION_CALL
// (the model attempts a native function call the API can't serialize). Upstream still
// returns HTTP 200 and streams a terminal frame with empty content, which the translator
// maps to finish_reason "stop". The combo's HTTP-status check then logs "succeeded" and
// the empty response reaches the client.
//
// A clean end without a content frame covers MALFORMED_FUNCTION_CALL and future Gemini
// abort reasons. Explicit SSE failures and rejected reads are distinct from clean emptiness.

import {
  NO_RETRY_EMPTY_FINISH, OPENAI_FINISH, RESPONSES_STATUS, RESPONSES_INCOMPLETE_REASON,
} from "../translator/schema/finishReasons.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { CLAUDE_EVENT, CLAUDE_DELTA, RESPONSES_EVENT, RESPONSES_EVENT_PREFIX } from "../translator/schema/streamEvents.js";
import { toOpenAIFinish } from "../translator/concerns/finishReason.js";
import { FORMATS } from "../translator/formats.js";
import { EMPTY_PEEK_DEADLINE_MS } from "../config/runtimeConfig.js";
import { describeUpstreamDisconnect, getUpstreamDisconnectStatus } from "../utils/error.js";
import { detectSseEventError, parseSSELine } from "../utils/streamHelpers.js";

// OpenAI chat content test. A chunk counts as content only if it carries
// assistant output the caller can consume:
//   * delta.content (non-empty string, or non-empty array of parts)
//   * delta.tool_calls (a real tool call)
// It deliberately does NOT count:
//   * delta.role — 9router emits {role:"assistant"} on the first frame regardless of
//     content; treating it as content would defeat the whole check (and A0's own retry,
//     which is gated on "no chunk received yet").
//   * reasoning_content / delta.reasoning — a think-then-abort produces reasoning only,
//     which A0 treats as an unusable-but-non-empty turn; it must still fall through.
export function deltaHasClientContent(delta) {
  if (!delta || typeof delta !== "object") return false;
  const c = delta.content;
  if (typeof c === "string" && c.length > 0) return true;
  if (Array.isArray(c) && c.length > 0) return true;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  // OpenAI "Responses" style / non-chat deltas occasionally use output_text
  if (typeof delta.output_text === "string" && delta.output_text.length > 0) return true;
  return false;
}

// The peek reads the CLIENT-format stream, which is OpenAI chat (/v1/chat/completions),
// Anthropic Messages (/v1/messages) or OpenAI Responses (/v1/responses). A format the peek
// cannot read never shows content: every combo member would be judged "empty" and called in
// turn, and the LAST one returned. Every format gets the same rule: answer text and tool calls
// are content; reasoning / thinking is not (as reasoning_content is not). Finish reasons are
// reported in the hub (OpenAI) vocabulary so isNoRetryFinish applies to every format.
const nonEmptyString = (s) => typeof s === "string" && s.length > 0;

// Anthropic Messages event.
function inspectClaudeEvent(obj, type) {
  let content = false, finishReason = null;
  if (type === CLAUDE_EVENT.CONTENT_BLOCK_DELTA) {
    const d = obj.delta || {};
    if (d.type === CLAUDE_DELTA.TEXT && nonEmptyString(d.text)) content = true;
    if (d.type === CLAUDE_DELTA.INPUT_JSON && nonEmptyString(d.partial_json)) content = true;
  } else if (type === CLAUDE_EVENT.CONTENT_BLOCK_START) {
    const b = obj.content_block || {};
    if (b.type === CLAUDE_BLOCK.TOOL_USE) content = true;
    if (b.type === CLAUDE_BLOCK.TEXT && nonEmptyString(b.text)) content = true;
  } else if (type === CLAUDE_EVENT.MESSAGE_DELTA && obj.delta?.stop_reason) {
    // refusal → content_filter (the translator renders content_filter as refusal for Claude clients)
    finishReason = toOpenAIFinish(obj.delta.stop_reason, FORMATS.CLAUDE);
  }
  return { content, finishReason };
}

// OpenAI Responses event. Tool calls are function_call / custom_tool_call output items or
// their argument deltas. An incomplete event can mean a no-retry content filter or
// an output limit, depending on incomplete_details.reason.
const RESPONSES_TOOL_ITEMS = new Set([RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL]);
const RESPONSES_INCOMPLETE_FINISH = {
  [RESPONSES_INCOMPLETE_REASON.CONTENT_FILTER]: OPENAI_FINISH.CONTENT_FILTER,
  [RESPONSES_INCOMPLETE_REASON.MAX_OUTPUT_TOKENS]: OPENAI_FINISH.LENGTH,
};
function inspectResponsesEvent(obj, type) {
  let content = false, finishReason = null;
  switch (type) {
    case RESPONSES_EVENT.OUTPUT_TEXT_DELTA:
    case RESPONSES_EVENT.FUNCTION_CALL_ARGUMENTS_DELTA:
    case RESPONSES_EVENT.CUSTOM_TOOL_CALL_INPUT_DELTA:
      content = nonEmptyString(obj.delta);
      break;
    case RESPONSES_EVENT.OUTPUT_TEXT_DONE:
      content = nonEmptyString(obj.text);
      break;
    case RESPONSES_EVENT.OUTPUT_ITEM_ADDED:
    case RESPONSES_EVENT.OUTPUT_ITEM_DONE:
      content = RESPONSES_TOOL_ITEMS.has(obj.item?.type);
      break;
    case RESPONSES_EVENT.COMPLETED:
      finishReason = OPENAI_FINISH.STOP;
      break;
    case RESPONSES_EVENT.INCOMPLETE:
      finishReason = RESPONSES_INCOMPLETE_FINISH[obj.response?.incomplete_details?.reason] || RESPONSES_STATUS.INCOMPLETE;
      break;
  }
  return { content, finishReason };
}

// Inspect one complete client-format data line using the event name, when present.
export function inspectSSELine(line, eventName) {
  const trimmed = line.trimStart();
  const parsed = trimmed.startsWith("data:") ? parseSSELine(trimmed) : null;
  if (!parsed || parsed.done) return { content: false, finishReason: null };
  const type = eventName || parsed.type;
  const isResponsesFailure = type === RESPONSES_EVENT.FAILED || parsed.response?.status === RESPONSES_STATUS.FAILED;
  if (!isResponsesFailure && Array.isArray(parsed.choices)) {
    for (const choice of parsed.choices) {
      if (deltaHasClientContent(choice?.delta || choice?.message)) return { content: true, finishReason: null };
    }
  }
  const error = detectSseEventError(parsed, eventName);
  if (error) {
    return { content: false, finishReason: type === RESPONSES_EVENT.FAILED ? RESPONSES_STATUS.FAILED : null, error };
  }
  if (typeof type === "string" && !Array.isArray(parsed.choices)) {
    return type.startsWith(RESPONSES_EVENT_PREFIX) ? inspectResponsesEvent(parsed, type) : inspectClaudeEvent(parsed, type);
  }
  let content = false, finishReason = null;
  for (const choice of Array.isArray(parsed.choices) ? parsed.choices : []) {
    if (deltaHasClientContent(choice?.delta || choice?.message)) content = true;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason };
}

// Scan complete lines in wire order. Keep the event name across reads and reset it at
// a blank line. Leave a partial line in state.pending for the next read.
export function scanSSEBuffer(text, state = { sawContent: false, finishReason: null }) {
  const lines = text.split("\n");
  state.pending = lines.pop();
  for (const line of lines) {
    if (state.sawContent || state.error) break;
    const trimmed = line.trim();
    if (!trimmed) {
      state.eventName = undefined;
      continue;
    }
    if (trimmed.startsWith("event:")) {
      state.eventName = trimmed.slice(6).trim();
      continue;
    }
    const info = inspectSSELine(trimmed, state.eventName);
    if (info.error) {
      if (!isNoRetryFinish(state.finishReason)) state.error = info.error;
      continue;
    }
    if (info.finishReason) state.finishReason = info.finishReason;
    if (info.content) state.sawContent = true;
  }
  return state;
}

// True when a finished, content-less stream should NOT be retried because the emptiness
// is legitimate and would recur on every candidate (safety / recitation / blocklist /
// prohibited-content). Everything else that finished empty is retryable.
export function isNoRetryFinish(finishReason) {
  if (!finishReason) return false;
  return NO_RETRY_EMPTY_FINISH.has(String(finishReason).toLowerCase());
}

// Cancel without blocking fallback on the upstream's cleanup. A reader may already be errored.
export function cancelStreamReader(reader, reason, pendingRead = null) {
  if (!reader) return;
  try {
    void reader.cancel(reason).catch(() => {});
  } catch { /* best effort */ }
  const release = () => { try { reader.releaseLock(); } catch { /* read is still settling */ } };
  if (pendingRead) pendingRead.then(release, release);
  else release();
}

// Read until content, clean EOF, failure, or the fail-open deadline. Replayable outcomes
// carry the original bytes and, on deadline, the in-flight read that owns the next chunk.
export async function peekStreamForContent(body, { deadlineMs = EMPTY_PEEK_DEADLINE_MS } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const headChunks = [];
  const state = { sawContent: false, finishReason: null };
  let textBuf = "";

  // Clamp: 0 / NaN / negative would otherwise disable the timeout and let a stalled-but-open
  // upstream hang the request forever in the hot path. There is no "disable" via this value.
  const validDeadline = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : EMPTY_PEEK_DEADLINE_MS;
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve("__deadline__"), validDeadline); });
  let handedOff = false;
  const replay = (outcome, liveReader = null, pendingRead = null) => {
    handedOff = liveReader !== null;
    return { outcome, head: headChunks, reader: liveReader, pendingRead, finishReason: state.finishReason };
  };

  try {
    while (true) {
      const read = reader.read();
      const result = await Promise.race([read, deadline]);
      if (result === "__deadline__") return replay("deadline", reader, read);

      const { done, value } = result;
      if (done) {
        scanSSEBuffer(textBuf + decoder.decode() + "\n", state);
      } else {
        headChunks.push(value);
        scanSSEBuffer(textBuf + decoder.decode(value, { stream: true }), state);
        textBuf = state.pending;
      }

      if (state.error) return { outcome: "error", error: state.error };
      if (state.sawContent) return replay("content", done ? null : reader);
      if (done) return replay("empty");
    }
  } catch (error) {
    // A read failure after a legitimate no-retry terminal must not replace that terminal.
    if (isNoRetryFinish(state.finishReason)) return replay("empty");
    return {
      outcome: "error",
      error: {
        message: describeUpstreamDisconnect(error),
        status: getUpstreamDisconnectStatus(error),
        transport: true,
        cause: error,
      },
    };
  } finally {
    clearTimeout(timer);
    if (!handedOff) cancelStreamReader(reader);
  }
}

// Rebuild a ReadableStream that replays the buffered head bytes, then the handed-off in-flight
// read (if the peek ended on a deadline), then whatever remains from the reader. Sequential —
// only ever one outstanding reader.read() at a time.
export function reconstructStream(head, reader, pendingRead = null) {
  let pending = pendingRead;
  let activeRead = null;
  return new ReadableStream({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
      if (!reader) controller.close();
    },
    async pull(controller) {
      try {
        const read = activeRead = pending || reader.read();
        pending = null;
        const { done, value } = await read;
        activeRead = null;
        if (!reader) return; // cancelled during the read
        if (done) {
          reader.releaseLock();
          reader = null;
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        activeRead = null;
        if (!reader) return;
        reader.releaseLock();
        reader = null;
        throw error;
      }
    },
    cancel(reason) {
      const pendingRead = activeRead || pending;
      pending = null;
      const activeReader = reader;
      reader = null;
      activeRead = null;
      cancelStreamReader(activeReader, reason, pendingRead);
    },
  });
}
