// In-router retry for streams that fail before any content reached the client.
//
// Upstream SSE events are held back until the first event that carries content
// (text, reasoning, tool call, finish). Until then nothing has been sent to the
// client, so a failure — an in-band error frame ("Upstream HTTP/2 stream failed",
// "temporarily overloaded"), a dropped socket (undici "terminated"), or EOF with
// no output — can be retried by re-executing the request without the client
// ever seeing it. Once content flows the stream is committed: a later failure
// cannot be replayed (partial text/tool calls would be duplicated) and goes
// through the normal terminal-error path.
//
// ponytail: holds raw SSE only (text/event-stream); binary/NDJSON formats
// (kiro eventstream, ollama) pass through untouched.

import { detectSseEventError } from "./streamHelpers.js";
import { TRANSIENT_STREAM_ERROR_PATTERNS, PRE_CONTENT_RETRY_PATTERNS } from "../config/errorConfig.js";

const RETRY_PATTERNS = [...TRANSIENT_STREAM_ERROR_PATTERNS, ...PRE_CONTENT_RETRY_PATTERNS];

/** In-band error worth re-sending: transient wording or a 429/5xx code. */
export function isRetryablePreContentError(error) {
  const code = Number(error?.code);
  if (code === 429 || (code >= 500 && code < 600)) return true;
  const text = `${error?.message || ""} ${error?.code || ""} ${error?.type || ""}`.toLowerCase();
  return RETRY_PATTERNS.some((pattern) => text.includes(pattern));
}

// Event types that carry no user-visible data; safe to hold and drop on retry.
const PRE_CONTENT_TYPES = new Set([
  "message_start",
  "ping",
  "response.created",
  "response.in_progress",
  "response.queued",
  "response.output_item.added",
  "response.content_part.added",
]);

// Re-executed responses with these statuses are worth another attempt.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);

// Commit anyway once this much is held, so a chatty preamble cannot buffer forever.
const MAX_HELD_BYTES = 1024 * 1024;

const EVENT_SPLIT = /\r?\n\r?\n/;

/** True when the parsed event has no user-visible content yet. */
export function isPreContentEvent(parsed) {
  if (Array.isArray(parsed.choices)) {
    const choice = parsed.choices[0];
    if (!choice) return true;
    const delta = choice.delta || {};
    return !choice.finish_reason
      && !delta.content
      && !delta.reasoning_content
      && !delta.reasoning
      && !(Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)
      && !delta.function_call;
  }
  if (parsed.type === "content_block_start") {
    const block = parsed.content_block || {};
    return block.type !== "tool_use" && !block.text && !block.thinking;
  }
  return PRE_CONTENT_TYPES.has(parsed.type);
}

/**
 * Classify the complete SSE events in `text`.
 * @returns {{ state: "hold" } | { state: "content" } | { state: "error", message: string }}
 */
export function classifyPreContent(text) {
  const events = text.split(EVENT_SPLIT);
  events.pop(); // trailing part is incomplete (or empty)
  for (const event of events) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue; // comments, bare event: lines, terminator

    let parsed;
    try { parsed = JSON.parse(data); } catch { return { state: "content" }; }
    if (!parsed || typeof parsed !== "object") return { state: "content" };

    const error = detectSseEventError(parsed);
    if (error) {
      return isRetryablePreContentError(error)
        ? { state: "error", message: error.message || "upstream error" }
        : { state: "content" }; // permanent error: forward as-is, no retry
    }
    if (!isPreContentEvent(parsed)) return { state: "content" };
  }
  return { state: "hold" };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener?.("abort", done); resolve(); }
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/**
 * Wrap a streaming upstream response so pre-content failures are retried.
 *
 * @param {Response} response - Upstream SSE response (already status-checked)
 * @param {object} options
 * @param {() => Promise<Response>} options.reexecute - Sends the same request again
 * @param {number} options.attempts - Max retries (0 disables)
 * @param {number} options.delayMs - First retry delay; doubles per attempt
 * @param {AbortSignal} [options.signal] - Client/stall abort; stops retrying
 * @param {(message: string) => void} [options.onRetry] - Log hook
 * @returns {Response}
 */
export function withPreContentRetry(response, { reexecute, attempts, delayMs, signal, onRetry }) {
  if (!response?.body || !(attempts > 0) || typeof reexecute !== "function") return response;

  let reader = response.body.getReader();
  let decoder = new TextDecoder();
  let held = [];
  let heldText = "";
  let heldBytes = 0;
  let committed = false;
  let attempt = 0;

  const resetHeld = () => { held = []; heldText = ""; heldBytes = 0; decoder = new TextDecoder(); };

  // Re-execute until a usable stream is open or the budget runs out.
  // Returns false when the caller must give up with what it holds.
  async function retry(reason) {
    while (attempt < attempts && !signal?.aborted) {
      attempt++;
      const wait = delayMs * 2 ** (attempt - 1);
      onRetry?.(`${reason} · retry ${attempt}/${attempts} in ${wait}ms`);
      reader.cancel().catch(() => { });
      await sleep(wait, signal);
      if (signal?.aborted) return false;

      let next;
      try {
        next = await reexecute();
      } catch (error) {
        reason = error?.message || String(error);
        continue;
      }
      if (!next?.ok || !next.body) {
        const status = next?.status;
        await next?.body?.cancel?.().catch?.(() => { });
        if (!RETRYABLE_STATUSES.has(status)) return false;
        reason = `HTTP ${status}`;
        continue;
      }
      reader = next.body.getReader();
      resetHeld();
      return true;
    }
    return false;
  }

  const flushHeld = (controller) => {
    for (const chunk of held) controller.enqueue(chunk);
    resetHeld();
    committed = true;
  };

  const body = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (committed) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
          return;
        }

        let result;
        try {
          result = await reader.read();
        } catch (error) {
          // Transport drop (undici "terminated", ECONNRESET…). Client/stall aborts stop here.
          if (error?.name !== "AbortError" && await retry(error?.message || String(error))) continue;
          flushHeld(controller);
          throw error; // existing terminal-error path takes over
        }

        if (result.done) {
          if (await retry("upstream closed before any content")) continue;
          flushHeld(controller);
          controller.close();
          return;
        }

        held.push(result.value);
        heldBytes += result.value.byteLength || 0;
        heldText += decoder.decode(result.value, { stream: true });

        const verdict = classifyPreContent(heldText);
        if (verdict.state === "error") {
          if (await retry(verdict.message)) continue;
          flushHeld(controller); // forward the error frame as before
          return;
        }
        if (verdict.state === "content" || heldBytes > MAX_HELD_BYTES) {
          flushHeld(controller);
          return;
        }
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => { });
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
