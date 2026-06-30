/**
 * Early SSE keepalive wrapper for streaming route handlers.
 *
 * Strict HTTP clients (e.g. Codex CLI's `reqwest`, Claude Code/Anthropic SDK)
 * drop the connection if no bytes arrive shortly after the request. The proxy
 * may hold the streaming response until the upstream's first useful byte, which
 * can exceed those idle timeouts for reasoning models. This wrapper keeps the
 * connection warm without disturbing the handler's internal logic.
 *
 * Fast path: if the handler resolves within `thresholdMs`, its `Response` is
 * returned verbatim. Slow path: after `thresholdMs`, a 200 `text/event-stream`
 * response is opened and SSE keepalive frames are emitted until the handler
 * resolves; its body is then forwarded. If the handler ultimately fails, a
 * structured `event: error` frame is emitted in-band.
 */

const ENCODER = new TextEncoder();
const DEFAULT_KEEPALIVE_FRAME = ENCODER.encode(": keepalive\n\n");
// Anthropic Messages-format keepalive: a real `ping` SSE event. Anthropic clients
// reset their stream watchdog on real SSE events but ignore SSE comments.
export const ANTHROPIC_PING_FRAME = ENCODER.encode(
  'event: ping\ndata: {"type":"ping"}\n\n'
);
const ERROR_FRAME = ENCODER.encode(
  `event: error\ndata: ${JSON.stringify({
    error: { message: "Upstream stream failed before completion.", type: "stream_error" },
  })}\n\n`
);

function normalizeError(maybeError) {
  if (maybeError instanceof Error) return maybeError;
  return new Error(
    typeof maybeError === "string" ? maybeError : "Upstream handler failed"
  );
}

/**
 * @param {Promise<Response>} handlerPromise
 * @param {object} [options]
 * @param {number} [options.thresholdMs=2000]
 * @param {number} [options.intervalMs=2500]
 * @param {AbortSignal|null} [options.signal]
 * @param {Uint8Array} [options.keepaliveFrame]
 * @returns {Promise<Response>}
 */
export async function withEarlyStreamKeepalive(handlerPromise, options = {}) {
  const thresholdMs = Math.max(0, options.thresholdMs ?? 2_000);
  const intervalMs = Math.max(250, options.intervalMs ?? 2_500);
  const signal = options.signal ?? null;
  const keepaliveFrame = options.keepaliveFrame ?? DEFAULT_KEEPALIVE_FRAME;

  const settled = handlerPromise.then(
    (response) => ({ ok: true, response }),
    (error) => ({ ok: false, error: normalizeError(error) })
  );

  let timer;
  const raced = await Promise.race([
    settled.then((result) => ({ kind: "settled", result })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), thresholdMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  if (raced.kind === "settled") {
    if (raced.result.ok) return raced.result.response;
    throw raced.result.error;
  }

  let stopKeepalive = () => {};
  let upstreamReader = null;
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      let stopped = false;
      const interval = setInterval(() => {
        if (stopped) return;
        try {
          controller.enqueue(keepaliveFrame);
        } catch {
          stopped = true;
          clearInterval(interval);
        }
      }, intervalMs);
      if (interval && typeof interval === "object" && "unref" in interval) {
        interval.unref?.();
      }
      try {
        controller.enqueue(keepaliveFrame);
      } catch {
        /* consumer already gone */
      }

      stopKeepalive = () => {
        stopped = true;
        clearInterval(interval);
      };

      const onAbort = () => {
        aborted = true;
        stopKeepalive();
        upstreamReader?.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const result = await settled;
        stopKeepalive();
        if (aborted) return;

        if (!result.ok) {
          controller.enqueue(ERROR_FRAME);
        } else {
          const response = result.response;
          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          const isSse = contentType.includes("text/event-stream");

          if (response.body && isSse) {
            upstreamReader = response.body.getReader();
            while (true) {
              const { done, value } = await upstreamReader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } else {
            const text = response.body
              ? await response.text().catch(() => "")
              : "";
            const dataLine =
              text.trim() ||
              JSON.stringify({
                error: { message: "stream_error", type: "stream_error" },
              });
            controller.enqueue(ENCODER.encode(`event: error\ndata: ${dataLine}\n\n`));
          }
        }
      } catch {
        if (!aborted) {
          try {
            controller.enqueue(ERROR_FRAME);
          } catch {
            /* consumer gone */
          }
        }
      } finally {
        stopKeepalive();
        signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      aborted = true;
      stopKeepalive();
      upstreamReader?.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
