// Empty-stream guard for Antigravity: Gemini occasionally returns a 200 SSE
// stream that carries no usable output — no candidates at all, thought-only
// parts, or a benign STOP finish with empty text — or aborts the turn with an
// error finishReason (MALFORMED_FUNCTION_CALL) before emitting anything.
// Delivered as-is the client receives a blank turn and silently halts
// (#2188, #2229, #2259). The guard probes the upstream stream before anything
// is sent to the client, so a bad attempt can be retried in place with the
// identical request; a healthy stream is released on its first meaningful
// part and replayed byte-identically.
import { GEMINI_ERROR_FINISH_REASONS } from "../../translator/schema/finishReasons.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";

// Mirrors oh-my-pi's empty-response policy: 2 retries, 500ms * 2^attempt backoff.
export const EMPTY_STREAM_MAX_RETRIES = 2;
export const EMPTY_STREAM_BASE_DELAY_MS = 500;

// A part is meaningful when it carries output the client can act on: a tool
// call, inline data, or non-whitespace visible text. Thought-only parts are
// not — thinking that never produced an answer IS the empty-response failure.
function isMeaningfulPart(part) {
  if (part.functionCall) return true;
  if (part.inlineData?.data || part.inline_data?.data) return true;
  if (part.thought === true) return false;
  return typeof part.text === "string" && part.text.trim().length > 0;
}

/**
 * Read the upstream SSE body until a verdict is reached, buffering every raw
 * chunk so a healthy stream can be replayed without loss.
 *
 * Verdicts:
 * - { verdict: "ok", buffered, reader }        first meaningful part seen
 * - { verdict: "empty", buffered }             stream ended with nothing meaningful
 * - { verdict: "error_finish", reason, buffered } aborted (MALFORMED_FUNCTION_CALL, ...)
 *   or an {error:{...}} object arrived before any meaningful part
 * - { verdict: "aborted" }                     client disconnected
 */
export async function probeSSEStream(body, { signal, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buffered = [];
  let lineBuffer = "";

  while (true) {
    if (signal?.aborted) {
      try { reader.cancel(); } catch { /* already closed */ }
      return { verdict: "aborted" };
    }

    let readResult;
    try {
      // Defensive stall escape: a byte-silent upstream must not hang the probe.
      readResult = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ __stalled: true }), stallTimeoutMs)),
      ]);
    } catch {
      return { verdict: "empty", buffered };
    }
    if (readResult.__stalled) {
      try { reader.cancel(); } catch { /* already closed */ }
      return { verdict: "empty", buffered };
    }

    const { done, value } = readResult;
    if (done) return { verdict: "empty", buffered };

    buffered.push(value);
    lineBuffer += decoder.decode(value, { stream: true });

    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop(); // keep the trailing partial line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // partial JSON split across reads — wait for more bytes
      }

      // Antigravity wrapper
      const response = parsed.response || parsed;
      if (!response || typeof response !== "object") continue;

      if (response.error || parsed.error) {
        return { verdict: "error_finish", reason: (response.error || parsed.error).status || "error", buffered };
      }

      const candidate = response.candidates?.[0];
      if (!candidate) continue;

      for (const part of candidate.content?.parts || []) {
        if (isMeaningfulPart(part)) return { verdict: "ok", buffered, reader };
      }

      const finishReason = candidate.finishReason && String(candidate.finishReason).toUpperCase();
      if (finishReason && GEMINI_ERROR_FINISH_REASONS.has(finishReason)) {
        return { verdict: "error_finish", reason: finishReason, buffered };
      }
      // Benign finish with nothing meaningful streamed → keep reading; if the
      // stream ends here it's the empty-response failure.
    }
  }
}

/**
 * Rebuild a byte-identical body: replay the probed prefix, then pump the rest
 * of the upstream reader.
 */
export function replayStream(buffered, reader) {
  return new ReadableStream({
    async start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
      if (!reader) {
        controller.close();
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      try { reader?.cancel(reason); } catch { /* already closed */ }
    },
  });
}
