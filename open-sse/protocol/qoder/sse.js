/**
 * Unwrap Qoder `{ statusCodeValue, body }` SSE into plain OpenAI SSE.
 *
 * Special tokens: [DONE] | [NOT_EXCEED_QUOTA] | [EXCEED_QUOTA]* | [NOTIFICATIONS]*
 *
 * Non-200 envelopes become an OpenAI-shaped **error** event (not fake content).
 */

import { SSE_DONE } from "../../utils/sseConstants.js";

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

/** Official special body tokens (Bun EPA). */
function isSpecialToken(data) {
  return (
    data === "[DONE]" ||
    data === "[NOT_EXCEED_QUOTA]" ||
    data.startsWith("[EXCEED_QUOTA]") ||
    data.startsWith("[NOTIFICATIONS]")
  );
}

function emitDone(controller, state) {
  if (state.doneEmitted) return;
  controller.enqueue(new TextEncoder().encode(SSE_DONE));
  state.doneEmitted = true;
}

/**
 * Emit a standard OpenAI streaming error (top-level {error:{...}} without
 * chunk scaffolding) so OpenAI SDKs surface it instead of ignoring it.
 */
function emitOpenAIError(controller, state, { model, message, statusVal, type, code }) {
  const errPayload = JSON.stringify({
    error: {
      message: stripHtml(truncate(message, 500)) || `qoder upstream status ${statusVal}`,
      type: type || "qoder_upstream_error",
      code: code ?? statusVal,
    },
  });
  controller.enqueue(new TextEncoder().encode(`data: ${errPayload}\n\n`));
  emitDone(controller, state);
}

/** finish_reason values that are NOT real terminal signals. */
const NULL_FINISH = new Set(["null", ""]);

/**
 * Inspect an inner OpenAI chunk for finish_reason issues:
 *  - "null" string → strip (server means "not finished yet")  [S1]
 *  - "model_context_window_exceeded" → emit 413 error          [S2]
 * Returns the (possibly modified) chunk OBJECT, or null if an error was emitted.
 */
function handleFinishReasonObj(chunk, controller, state, model) {
  if (!chunk || typeof chunk !== "object" || !Array.isArray(chunk.choices)) return chunk;

  for (const choice of chunk.choices) {
    const fr = choice?.finish_reason;
    if (fr == null) continue;

    // S2: context window exceeded → 413 error, not a successful finish
    if (fr === "model_context_window_exceeded") {
      emitOpenAIError(controller, state, {
        model,
        message: "Model context window exceeded",
        statusVal: 413,
        type: "context_length_exceeded",
        code: "context_length_exceeded",
      });
      return null;
    }

    // S1: "null" string means "not finished" — strip it
    if (NULL_FINISH.has(fr)) {
      choice.finish_reason = null;
    }
  }

  return chunk;
}

/** Check if a chunk is a usage-only final chunk (choices:[] + usage). */
function isUsageOnlyChunk(chunk) {
  return chunk && typeof chunk === "object" &&
    Array.isArray(chunk.choices) && chunk.choices.length === 0 &&
    chunk.usage && typeof chunk.usage === "object";
}

/** Check if a chunk has a real (non-null) finish_reason. */
function hasRealFinish(chunk) {
  if (!chunk?.choices) return false;
  return chunk.choices.some((c) => c?.finish_reason != null && !NULL_FINISH.has(c.finish_reason));
}

/** Emit a chunk object as SSE data. */
function emitChunk(controller, encoder, state, chunk) {
  normalizeReasoningItem(chunk); // S9: reasoning_item → reasoning_content
  const sanitized = JSON.stringify(chunk).replace(/\r?\n/g, "");
  state.contentEmitted = true;
  controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
}

/** S13: Strip HTML tags from error messages (e.g. 504 pages). */
function stripHtml(s) {
  if (!s || typeof s !== "string") return s;
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || s;
}

/** S9: Normalize delta.reasoning_item → delta.reasoning_content for downstream. */
function normalizeReasoningItem(chunk) {
  if (!chunk?.choices) return chunk;
  for (const choice of chunk.choices) {
    const delta = choice?.delta;
    if (!delta) continue;
    if (delta.reasoning_item && !delta.reasoning_content) {
      // reasoning_item: {summary:[{text:"..."}], encrypted_content:"..."}
      const item = delta.reasoning_item;
      const text = Array.isArray(item.summary)
        ? item.summary.map((s) => s?.text || "").join("")
        : typeof item === "string" ? item : "";
      if (text) delta.reasoning_content = text;
      delete delta.reasoning_item;
    }
  }
  return chunk;
}

/**
 * @param {Response} response
 * @param {string} model - label for error chunks
 */
function wrapQoderSSE(response, model) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { doneEmitted: false, lastEvent: "", contentEmitted: false };

  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    // S8: track SSE event: lines (e.g. "event: finish" gates normal termination)
    if (trimmed.startsWith("event:")) {
      state.lastEvent = trimmed.slice(6).trim();
      return;
    }
    if (!trimmed.startsWith("data:")) return;
    if (state.doneEmitted) return;

    const data = trimmed.slice(5).trimStart();

    // Top-level special tokens (no JSON envelope)
    if (data === "[DONE]") {
      emitDone(controller, state);
      return;
    }
    if (data === "[NOT_EXCEED_QUOTA]" || data.startsWith("[NOTIFICATIONS]")) {
      // Control / advisory — do not forward as model content
      return;
    }
    if (data.startsWith("[EXCEED_QUOTA]")) {
      emitOpenAIError(controller, state, {
        model,
        message: data,
        statusVal: 429,
      });
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(data);
    } catch {
      return;
    }

    // Non-envelope JSON: ignore (not official chat path)
    if (envelope == null || typeof envelope !== "object") return;

    const statusVal =
      typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
    const inner = typeof envelope.body === "string" ? envelope.body : "";

    if (statusVal !== 200) {
      // S8: "event: finish" + non-200 = normal termination signal, not an error
      if (state.lastEvent === "finish") {
        emitDone(controller, state);
        return;
      }
      // S4: classify auth errors so clients can trigger refresh/reconnect
      const isAuth = statusVal === 103 || statusVal === 105 ||
        /login expired|login timeout|token.*expired|auth/i.test(inner);
      // S12: classify queue/model-busy errors for retry signaling
      const isQueue = statusVal === 10605 || /queue|isQueued|retry_after/i.test(inner);
      emitOpenAIError(controller, state, {
        model,
        message: inner || `upstream status ${statusVal}`,
        statusVal: isAuth ? 401 : isQueue ? 429 : statusVal,
        type: isAuth ? "authentication_error" : isQueue ? "model_queued" : "qoder_upstream_error",
        code: isAuth ? "token_expired" : isQueue ? "model_queued" : statusVal,
      });
      return;
    }

    if (!inner) return;

    if (isSpecialToken(inner)) {
      if (inner === "[DONE]") {
        emitDone(controller, state);
        return;
      }
      if (inner.startsWith("[EXCEED_QUOTA]")) {
        emitOpenAIError(controller, state, { model, message: inner, statusVal: 429 });
        return;
      }
      // NOT_EXCEED_QUOTA / NOTIFICATIONS — skip
      return;
    }

    // OpenAI-shaped chunk — parse, inspect finish_reason, handle usage merge [S1/S2/S5]
    let chunk;
    try {
      chunk = JSON.parse(inner);
    } catch {
      // Not JSON — forward raw
      const sanitized = inner.replace(/\r?\n/g, "");
      state.contentEmitted = true;
      controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
      return;
    }

    const handled = handleFinishReasonObj(chunk, controller, state, model);
    if (handled === null) return; // error was emitted (S2)

    // S5: usage-only chunk (choices:[] + usage) — merge into buffered finish chunk
    if (isUsageOnlyChunk(handled)) {
      if (state.pendingFinish) {
        state.pendingFinish.usage = handled.usage;
        emitChunk(controller, encoder, state, state.pendingFinish);
        state.pendingFinish = null;
      }
      // If no pending finish, drop the usage-only chunk (stream.js doesn't need it)
      return;
    }

    // S5: finish chunk without usage — buffer it, wait for the real usage chunk
    if (hasRealFinish(handled) && !(handled.usage && typeof handled.usage === "object")) {
      state.pendingFinish = handled;
      return;
    }

    // Flush any buffered finish (next chunk arrived that isn't usage-only)
    if (state.pendingFinish) {
      emitChunk(controller, encoder, state, state.pendingFinish);
      state.pendingFinish = null;
    }

    emitChunk(controller, encoder, state, handled);
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line, controller);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        processLine(buffer, controller);
        buffer = "";
      }
      // Flush any buffered finish chunk (usage-only chunk never arrived)
      if (state.pendingFinish) {
        emitChunk(controller, encoder, state, state.pendingFinish);
        state.pendingFinish = null;
      }
      // S7: stream ended with no content → emit error instead of silent [DONE]
      if (!state.contentEmitted && !state.doneEmitted) {
        emitOpenAIError(controller, state, {
          model,
          message: "Empty response: stream ended without any content",
          statusVal: 502,
          type: "empty_response",
          code: "empty_response",
        });
        return;
      }
      emitDone(controller, state);
    },
  });

  const transformed = response.body.pipeThrough(transform);
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export { wrapQoderSSE, isSpecialToken };
