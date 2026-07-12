/**
 * Early SSE response helpers for reverse-proxy / Cloudflare 504 avoidance.
 *
 * Cloudflare Free/Pro aborts the origin connection if no response bytes arrive
 * within ~100s. 9router normally awaits upstream headers before returning a
 * Response, so slow providers / retries trip CF origin_gateway_timeout.
 *
 * Pattern: return a streaming Response immediately, emit SSE comment keepalives
 * while work runs, then pipe the real upstream SSE (or an error event).
 */

import { SSE_HEADERS_CORS, SSE_DONE } from "./sseConstants.js";

const KEEPALIVE_MS = 15_000;
const encoder = new TextEncoder();

export function isCloudflareRequest(headers = {}) {
  if (!headers || typeof headers !== "object") return false;
  // Headers may be a Headers instance or a plain object with mixed casing.
  const get = (name) => {
    if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
    return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  };
  return !!(get("cf-ray") || get("CF-Ray") || get("cf-connecting-ip") || get("CF-Connecting-IP"));
}

/**
 * True only when the request body explicitly asks for streaming.
 * Do NOT infer this from Accept: many SDKs send broad/SSE-capable Accept headers
 * while still expecting one JSON response. Wrapping those in early SSE returns
 * HTTP 200 with a malformed body from the client's point of view.
 */
export function clientWantsStream(body) {
  return body?.stream === true;
}

function sseErrorBytes(message, status = 502) {
  // OpenAI-compatible error chunk + DONE so clients terminate cleanly mid-stream.
  const payload = JSON.stringify({
    error: { message: String(message || "Upstream error"), type: "server_error", code: status },
  });
  return encoder.encode(`data: ${payload}\n\n${SSE_DONE}`);
}

/**
 * @param {(api: { enqueue: (u8: Uint8Array) => void, signal: AbortSignal }) => Promise<Response|void>} work
 *   work may return a Response whose body should be piped, or write via enqueue and return void.
 */
export function createKeepaliveSseResponse(work) {
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Immediate first byte so Cloudflare / nginx see an open stream (TTFB ≈ 0).
      safeEnqueue(encoder.encode(": connected\n\n"));

      const ka = setInterval(() => {
        safeEnqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      }, KEEPALIVE_MS);

      try {
        const result = await work({
          enqueue: safeEnqueue,
          signal: abort.signal,
          writeError: (message, status) => safeEnqueue(sseErrorBytes(message, status)),
        });

        if (result instanceof Response && result.body) {
          const ct = (result.headers.get("content-type") || "").toLowerCase();
          const isSse = ct.includes("text/event-stream") || result.status === 200 && ct === "";
          // Error JSON (or any non-SSE body) must become an SSE error event —
          // the HTTP status is already 200 from the early open.
          if (!isSse || (result.status >= 400 && !ct.includes("text/event-stream"))) {
            let msg = `Upstream error (${result.status})`;
            try {
              const text = await result.text();
              try {
                const j = JSON.parse(text);
                msg = j?.error?.message || j?.message || text.slice(0, 300) || msg;
              } catch {
                if (text) msg = text.replace(/<[^>]*>/g, "").slice(0, 300) || msg;
              }
            } catch {
              /* ignore body read */
            }
            safeEnqueue(sseErrorBytes(msg, result.status));
          } else {
            const reader = result.body.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) safeEnqueue(value);
              }
            } finally {
              try {
                reader.releaseLock();
              } catch {
                /* ignore */
              }
            }
          }
        }
        safeClose();
      } catch (err) {
        if (err?.name !== "AbortError") {
          safeEnqueue(sseErrorBytes(err?.message || String(err), 502));
        }
        safeClose();
      } finally {
        clearInterval(ka);
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...SSE_HEADERS_CORS,
      "X-Accel-Buffering": "no",
    },
  });
}
