import { buildResponsesFailureTerminalBytes } from "./responsesStreamHelpers.js";
import { SSE_HEADERS_CORS } from "./sseConstants.js";

const encoder = new TextEncoder();
const CONNECTED = encoder.encode(": connected\n\n");
const KEEPALIVE = encoder.encode(": keepalive\n\n");
const EVENT_KEEPALIVE = encoder.encode('event: 9router.keepalive\ndata: {"type":"9router.keepalive"}\n\n');

function extractErrorMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    const value = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 2000);
    if (value) return JSON.stringify(value).slice(0, 2000);
  } catch { /* use plain text below */ }

  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return plain.slice(0, 2000) || `Upstream request failed with HTTP ${status || 502}`;
}

/**
 * Return downstream SSE immediately while provider/account routing continues.
 * Comments keep reverse proxies alive without becoming Responses API events.
 */
export function createDeferredResponsesResponse(run, {
  signal: parentSignal,
  keepaliveMs = 25_000,
  model = "unknown",
  eventKeepalive = false,
} = {}) {
  const workController = new AbortController();
  let streamController = null;
  let closed = false;
  let keepalive = null;
  let upstreamReader = null;
  let parentAbort = null;
  let pullFromUpstream = null;
  let readyState = { kind: "pending" };
  let atSseBoundary = true;
  let lineHasData = false;
  let trailingCr = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const stopKeepalive = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
  };

  const cleanup = () => {
    stopKeepalive();
    if (parentAbort) {
      parentSignal?.removeEventListener("abort", parentAbort);
      parentAbort = null;
    }
  };

  const settleReady = (state) => {
    if (readyState.kind !== "pending") return;
    readyState = state;
    resolveReady(state);
  };

  const observeSseBytes = (bytes) => {
    for (const byte of bytes) {
      if (byte === 13) {
        atSseBoundary = !lineHasData;
        lineHasData = false;
        trailingCr = true;
      } else if (byte === 10) {
        if (trailingCr) {
          trailingCr = false;
        } else {
          atSseBoundary = !lineHasData;
          lineHasData = false;
        }
      } else {
        atSseBoundary = false;
        lineHasData = true;
        trailingCr = false;
      }
    }
  };

  const cancelWork = (reason, closeStream = false) => {
    if (closed) return;
    closed = true;
    cleanup();
    if (!workController.signal.aborted) workController.abort(reason);
    upstreamReader?.cancel(reason).catch(() => {});
    settleReady({ kind: "closed" });
    if (closeStream) {
      try { streamController?.close(); } catch { /* downstream already closed */ }
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;

      const finish = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try { controller.close(); } catch { /* downstream already closed */ }
      };

      const enqueue = (bytes) => {
        if (closed) return false;
        try {
          controller.enqueue(bytes);
          return true;
        } catch (error) {
          cancelWork(error);
          return false;
        }
      };

      parentAbort = () => cancelWork(parentSignal?.reason || "client closed", true);
      if (parentSignal?.aborted) {
        parentAbort();
        return;
      }
      parentSignal?.addEventListener("abort", parentAbort, { once: true });

      enqueue(CONNECTED);
      keepalive = setInterval(() => {
        if (readyState.kind === "pending") {
          enqueue(eventKeepalive ? EVENT_KEEPALIVE : KEEPALIVE);
        } else if (eventKeepalive && readyState.kind === "stream" && atSseBoundary && !trailingCr) {
          enqueue(EVENT_KEEPALIVE);
        }
      }, keepaliveMs);

      Promise.resolve()
        .then(async () => {
          if (closed || workController.signal.aborted) return;
          const response = await run(workController.signal);

          if (closed) {
            await response?.body?.cancel().catch(() => {});
            return;
          }
          if (!(response instanceof Response)) throw new Error("Chat handler returned an invalid response");

          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          if (!eventKeepalive || !contentType.includes("text/event-stream")) stopKeepalive();
          if (!contentType.includes("text/event-stream")) {
            const text = await response.text().catch(() => "");
            if (closed) return;
            settleReady({
              kind: "terminal",
              bytes: buildResponsesFailureTerminalBytes(extractErrorMessage(text, response.status), { model }),
            });
            return;
          }

          if (!response.body) throw new Error("Upstream SSE response has no body");
          upstreamReader = response.body.getReader();
          settleReady({ kind: "stream" });
        })
        .catch((error) => {
          if (closed || workController.signal.aborted) return;
          stopKeepalive();
          settleReady({
            kind: "terminal",
            bytes: buildResponsesFailureTerminalBytes(error?.message || "Upstream request failed", { model }),
          });
        });

      pullFromUpstream = async () => {
        const state = await ready;
        if (closed || state.kind === "closed") return;

        if (state.kind === "terminal") {
          enqueue(state.bytes);
          finish();
          return;
        }

        try {
          const { value, done } = await upstreamReader.read();
          if (closed) return;
          if (done) finish();
          else {
            if (eventKeepalive) observeSseBytes(value);
            enqueue(value);
          }
        } catch (error) {
          if (closed || workController.signal.aborted) return;
          enqueue(buildResponsesFailureTerminalBytes(error?.message || "Upstream stream failed", { model }));
          finish();
        }
      };
    },

    async pull() {
      return pullFromUpstream?.();
    },

    cancel(reason) {
      cancelWork(reason || "client closed");
    },
  });

  return new Response(stream, {
    headers: {
      ...SSE_HEADERS_CORS,
      "X-Accel-Buffering": "no",
    },
  });
}
