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
// The signal is STRUCTURAL, not an enum: "the stream ended and no content frame was ever
// released". That covers MALFORMED_FUNCTION_CALL, any future Gemini abort reason, and a
// stream that simply dies — with no reason vocabulary to keep in sync. The finish-reason
// enum is used only in the inverse: to NOT retry a legitimately-empty content-filter block.

import { NO_RETRY_EMPTY_FINISH } from "../translator/schema/finishReasons.js";
import { EMPTY_PEEK_DEADLINE_MS } from "../config/runtimeConfig.js";
import { parseSSELine } from "../utils/streamHelpers.js";

// Client-format (OpenAI SSE) content test. A chunk counts as content only if it carries
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

// Inspect one complete OpenAI-format SSE line (parsed with the shared parseSSELine) and report
// whether it carries content and/or a finish reason. Non-data lines and "[DONE]" carry nothing.
export function inspectSSELine(line) {
  const parsed = parseSSELine(line.trimStart());
  if (!parsed || parsed.done) return { content: false, finishReason: null };
  let content = false, finishReason = null;
  for (const choice of parsed.choices || []) {
    if (deltaHasClientContent(choice.delta || choice.message || {})) content = true;
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason };
}

// Scan the COMPLETE lines of a decoded SSE buffer and update the running decision.
// The trailing fragment (a line still being received) is not parsed — it is returned in
// `state.pending` for the caller to prepend to the next chunk. `sawContent` latches true.
export function scanSSEBuffer(text, state = { sawContent: false, finishReason: null }) {
  const lines = text.split("\n");
  state.pending = lines.pop();
  for (const line of lines) {
    const info = inspectSSELine(line);
    if (info.content) state.sawContent = true;
    if (info.finishReason) state.finishReason = info.finishReason;
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

// Peek a streaming Response body: read frames until the first content frame (→ "content"),
// the stream ends (→ "empty"), or the deadline elapses (→ "content", fail-open: never hold a
// possibly-valid slow stream). Returns the decision, the buffered head bytes, the live reader,
// and — if the deadline fired mid-read — the still-pending read() (`pendingRead`) so the caller
// can resume from it WITHOUT abandoning the chunk it will deliver.
export async function peekStreamForContent(body, { deadlineMs = EMPTY_PEEK_DEADLINE_MS } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const headChunks = [];
  const state = { sawContent: false, finishReason: null };
  let textBuf = "";

  // Clamp: 0 / NaN / negative would otherwise disable the timeout and let a stalled-but-open
  // upstream hang the request forever in the hot path. There is no "disable" via this value.
  const validDeadline = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : EMPTY_PEEK_DEADLINE_MS;
  let timer = null;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve("__deadline__"), validDeadline); });
  const settle = (ret) => { if (timer) { clearTimeout(timer); timer = null; } return ret; };

  let pendingRead = null;
  while (true) {
    if (!pendingRead) pendingRead = reader.read();
    let res;
    try {
      res = await Promise.race([pendingRead, deadline]);
    } catch (err) {
      // Upstream errored mid-peek. Body is locked to this reader; hand it back so the caller
      // can reconstruct (the replay will surface the same error). The failed read is consumed.
      pendingRead = null;
      return settle({ outcome: state.sawContent ? "content" : "empty", timedOut: false, head: headChunks, reader, pendingRead: null, finishReason: state.finishReason, error: err });
    }
    if (res === "__deadline__") {
      // Fail-open: commit whatever we have. Hand the STILL-PENDING read to the caller so its
      // chunk is replayed, not dropped (fixes the content-dropping deadline race).
      return settle({ outcome: "content", timedOut: true, head: headChunks, reader, pendingRead, finishReason: state.finishReason });
    }
    const { done, value } = res;
    pendingRead = null;
    if (done) {
      if (textBuf) scanSSEBuffer(textBuf + "\n", state); // final line without a trailing newline
      return settle({ outcome: state.sawContent ? "content" : "empty", timedOut: false, head: headChunks, reader, pendingRead: null, finishReason: state.finishReason });
    }
    headChunks.push(value);
    textBuf += decoder.decode(value, { stream: true });
    scanSSEBuffer(textBuf, state);
    textBuf = state.pending; // only the not-yet-complete line carries over
    if (state.sawContent) {
      return settle({ outcome: "content", timedOut: false, head: headChunks, reader, pendingRead: null, finishReason: state.finishReason });
    }
  }
}

// Rebuild a ReadableStream that replays the buffered head bytes, then the handed-off in-flight
// read (if the peek ended on a deadline), then whatever remains from the reader. Sequential —
// only ever one outstanding reader.read() at a time.
export function reconstructStream(head, reader, pendingRead = null) {
  let pending = pendingRead;
  return new ReadableStream({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
    },
    async pull(controller) {
      let result;
      if (pending) { result = await pending; pending = null; }
      else { result = await reader.read(); }
      const { done, value } = result;
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch { /* already closed */ }
    },
  });
}
