import { setTimeout as delay } from "node:timers/promises";
import { detectSseEventError, hasStreamOutput, readSseFields } from "./streamHelpers.js";
import { describeUpstreamDisconnect, detectErrorBody, getStreamErrorStatus, parseUpstreamError } from "./error.js";
import { STREAM_FAILURE_MESSAGES, TRANSIENT_STREAM_ERROR_PATTERNS, PRE_CONTENT_RETRY_PATTERNS } from "../config/errorConfig.js";
import { HTTP_STATUS, STREAM_FIRST_CHUNK_TIMEOUT_MS, STREAM_PREFLIGHT_MAX_BYTES, STREAM_PRECONTENT_RETRY_MAX_DELAY_MS } from "../config/runtimeConfig.js";

const RETRY_PATTERNS = [...TRANSIENT_STREAM_ERROR_PATTERNS, ...PRE_CONTENT_RETRY_PATTERNS];
const EVENT_BOUNDARY = /\r?\n\r?\n/g;

export function isRetryablePreContentError(error) {
  if (error?.retryable === false) return false;
  const status = getStreamErrorStatus(error);
  const text = [error?.message, error?.code, error?.type].filter(Boolean).join(" ").toLowerCase();
  if (status != null) {
    return status >= 500 || status === HTTP_STATUS.RATE_LIMITED || status === HTTP_STATUS.REQUEST_TIMEOUT
      || (status === HTTP_STATUS.BAD_REQUEST && TRANSIENT_STREAM_ERROR_PATTERNS.some((pattern) => text.includes(pattern)));
  }
  return /^unknown error[.!]?$/i.test(error?.message?.trim() || "") || RETRY_PATTERNS.some((pattern) => text.includes(pattern));
}

function inspectEvent(event) {
  const { eventName, data } = readSseFields(event);
  if (!data) return null;
  if (data === "[DONE]") return { error: { message: STREAM_FAILURE_MESSAGES.noOutput, status: HTTP_STATUS.BAD_GATEWAY } };

  let payload;
  try { payload = JSON.parse(data); } catch { /* invalid upstream SSE */ }
  const error = detectSseEventError(payload, eventName);
  if (error) return { error };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: { message: "Invalid upstream SSE payload", status: HTTP_STATUS.BAD_GATEWAY } };
  }
  return hasStreamOutput(payload, eventName) ? { accepted: true } : null;
}

function replayBody(reader, chunks, ended) {
  let index = 0;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index];
        chunks[index++] = null;
        controller.enqueue(chunk);
        return;
      }
      try {
        const next = ended ? { done: true } : await reader.read();
        if (cancelled) return;
        if (next.done) {
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        if (!cancelled) {
          reader.releaseLock();
          throw error;
        }
      }
    },
    cancel(reason) {
      cancelled = true;
      chunks.length = 0;
      // cancel resolves outstanding reads synchronously, even if transport cleanup hangs.
      try { void reader.cancel(reason).catch(() => {}); } finally { reader.releaseLock(); }
    },
  }, { highWaterMark: 0 });
}

/** Hold SSE metadata until a usable event or a definite failure. Never release a partial preamble on error. */
export async function inspectStreamingPrelude(response, {
  signal, timeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS, maxBytes = STREAM_PREFLIGHT_MAX_BYTES, json = false,
} = {}) {
  signal?.throwIfAborted();
  if (!response.body) return { error: { message: STREAM_FAILURE_MESSAGES.noOutput, status: HTTP_STATUS.BAD_GATEWAY } };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  let bytes = 0;
  let accepted = false;
  let timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (timedOut) return { error: { message: STREAM_FAILURE_MESSAGES.firstOutput, status: HTTP_STATUS.GATEWAY_TIMEOUT } };

      if (!done) {
        chunks.push(value);
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
      } else text += decoder.decode();

      if (json) {
        if (bytes > maxBytes) return { error: { message: "Upstream returned an oversized JSON body instead of SSE", status: HTTP_STATUS.BAD_GATEWAY, retryable: false } };
        if (!done) continue;
        let payload;
        try { payload = JSON.parse(text); } catch { /* report the protocol mismatch */ }
        return { error: detectErrorBody(payload) || { message: "Upstream returned JSON instead of SSE", status: HTTP_STATUS.BAD_GATEWAY, retryable: false } };
      }

      EVENT_BOUNDARY.lastIndex = 0;
      let offset = 0;
      let verdict;
      for (const boundary of text.matchAll(EVENT_BOUNDARY)) {
        verdict = inspectEvent(text.slice(offset, boundary.index));
        if (verdict) break;
        offset = boundary.index + boundary[0].length;
      }
      if (done && !verdict) verdict = inspectEvent(text.slice(offset));
      if (verdict?.error) return verdict;
      if (verdict?.accepted) {
        const replay = new Response(replayBody(reader, chunks, done), response);
        accepted = true;
        return { response: replay };
      }
      if (done) return { error: { message: STREAM_FAILURE_MESSAGES.noOutput, status: HTTP_STATUS.BAD_GATEWAY } };
      if (bytes > maxBytes) return { error: { message: "Upstream SSE preamble exceeded the buffer limit before first output", status: HTTP_STATUS.BAD_GATEWAY } };
      text = text.slice(offset);
    }
  } catch (cause) {
    signal?.throwIfAborted();
    return { error: { message: `${describeUpstreamDisconnect(cause)} before first output`, status: HTTP_STATUS.BAD_GATEWAY } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    if (!accepted) {
      cancel();
      reader.releaseLock();
    }
  }
}

/** Wait for preflight before returning HTTP 200. Each re-execution gets its own deadline. */
export async function prepareStreamingResponse(response, {
  reexecute, attempts = 0, delayMs = 0, maxDelayMs = STREAM_PRECONTENT_RETRY_MAX_DELAY_MS,
  timeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS, signal, onRetry, executor, allowMissingContentType = false,
} = {}) {
  let backoffMs = Math.min(delayMs, maxDelayMs);
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    if (!response) return { error: { message: STREAM_FAILURE_MESSAGES.noOutput, status: HTTP_STATUS.BAD_GATEWAY }, exhausted: true };
    if (!response.ok) {
      // The executor already spent its HTTP/header retry budget.
      const parsed = await parseUpstreamError(response, executor, { signal, timeoutMs });
      signal?.throwIfAborted();
      return {
        error: { message: parsed.message, status: parsed.statusCode, resetsAtMs: parsed.resetsAtMs },
        exhausted: isRetryablePreContentError({ status: parsed.statusCode, message: parsed.message }),
        headers: response.headers,
      };
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isSse = contentType.includes("text/event-stream") || (allowMissingContentType && !contentType);
    const isJson = !isSse && (contentType.includes("application/json") || contentType.includes("+json"));
    if (!isSse && !isJson) {
      void response.body?.cancel().catch(() => {});
      return { error: { message: `Upstream returned a non-streaming response (${contentType || "missing content type"})`, status: HTTP_STATUS.BAD_GATEWAY }, headers: response.headers };
    }

    const result = await inspectStreamingPrelude(response, { signal, timeoutMs, json: isJson });
    if (!result.error) return result;
    const { error } = result;
    const transient = isRetryablePreContentError(error);
    if (!transient || attempt >= attempts || !reexecute) {
      return { error, exhausted: transient, headers: response.headers };
    }

    onRetry?.(`${error.message} | retry ${attempt + 1}/${attempts} in ${backoffMs}ms`, error);
    if (backoffMs > 0) await delay(backoffMs, undefined, { signal });
    backoffMs = Math.min(backoffMs * 2, maxDelayMs);
    signal?.throwIfAborted();
    const headers = response.headers;
    try {
      response = await reexecute(signal);
      if (signal?.aborted) void response?.body?.cancel().catch(() => {});
    } catch (cause) {
      signal?.throwIfAborted();
      return { error: { message: describeUpstreamDisconnect(cause), status: HTTP_STATUS.BAD_GATEWAY }, exhausted: true, headers };
    }
  }
}
