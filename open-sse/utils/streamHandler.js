// Stream handler with disconnect detection - shared for all providers
import { STREAM_PRECOMMIT_MAX_BYTES, STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { OUTCOME_ERROR, parseSSEBlocks } from "./upstreamOutcome.js";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ onDisconnect, onError, log, provider, model, reqTag = "" } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      // Debug-only: Responses API has no [DONE] sentinel, so codex/droid close the
      // socket on every completed request. "📊 done" is the authoritative outcome line.
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: () => abortController.abort()
  };
}

// Wrap { onError, onCancel } so only the first abnormal end is reported.
function onceLifecycle(lifecycle = {}) {
  let settled = false;
  const once = (fn) => (value) => {
    if (settled) return;
    settled = true;
    fn?.(value);
  };
  return { onError: once(lifecycle.onError), onCancel: once(lifecycle.onCancel) };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 *
 * @param {function} [onAbortTerminal] - Receives a human-readable abort
 * message and returns terminal SSE bytes to emit downstream.
 * @param {object} [lifecycle] - { onError(error), onCancel(reason) }; at most one
 * of them fires, when the stream ends abnormally.
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null, lifecycle = {}) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  const { onError, onCancel } = onceLifecycle(lifecycle);
  let terminalEmitted = false;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        onCancel("client disconnected");
        emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(error);
        // A read that fails after the client left is the abort, not an upstream fault.
        if (!wasConnected || isControllerClosed) onCancel("client disconnected");
        else {
          if (!error.errorKind) error.errorKind = OUTCOME_ERROR.RESET;
          onError(error);
        }
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        // Treat network resets / socket hang up / abort as graceful close
        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkClose =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        // Graceful close on network/abort, or when a structured terminal is available
        // (Responses passthrough prefers response.failed + [DONE] over a raw transport error)
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(error);
          }
        } catch (e) { /* already closed or cancelled */ }
      }
    },

    cancel(reason) {
      onCancel(reason);
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 * @param {object} [lifecycle] - See createDisconnectAwareStream; a stall reports onError.
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS, lifecycle = {}) {
  const settle = onceLifecycle(lifecycle);
  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  let abortMessage = "upstream connection lost";
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      abortMessage = "stream stall timeout";
      dbg(tag, `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
      const error = Object.assign(new Error("stream stall timeout"), { errorKind: OUTCOME_ERROR.STALL });
      settle.onError(error);
      streamController.handleError?.(error);
      streamController.abort?.();
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); streamController.abort(); }
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${stallTimeoutMs}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`);
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() { dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); }
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    wrappedController,
    onAbortTerminal ? () => onAbortTerminal(abortMessage) : null,
    settle
  );
}

/**
 * Hold a streaming upstream response until it proves itself, before any byte is
 * committed downstream. Reads (and buffers) the body until the outcome tracker
 * sees output that can be streamed, a successful terminal, a failure, or EOF.
 *
 * A failure found here is still routable — the client has received nothing —
 * so the caller returns an error result and account/combo fallback can run.
 *
 * @returns {Promise<{ ok: true, reader, buffered: Uint8Array[], ended: boolean, outcome }
 *   | { ok: false, outcome }>}
 */
export async function createPrecommitStream(providerResponse, outcomeTracker, {
  signal,
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
  maxBufferedBytes = STREAM_PRECOMMIT_MAX_BYTES,
} = {}) {
  if (!providerResponse?.body) {
    return { ok: false, outcome: outcomeTracker.fail(OUTCOME_ERROR.EMPTY, "Upstream returned no response body") };
  }
  if (signal?.aborted) {
    providerResponse.body.cancel("request aborted").catch(() => {});
    return { ok: false, outcome: outcomeTracker.abortClient("Request aborted") };
  }

  const reader = providerResponse.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffered = [];
  let bufferedBytes = 0;
  let parseBuffer = "";
  let interrupt = null;

  // A stall or a client abort rejects the pending read and cancels the upstream.
  const stop = (error) => {
    interrupt?.(error);
    reader.cancel(error.message).catch(() => {});
  };
  const read = () => new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => stop(Object.assign(new Error("stream stall timeout"), { errorKind: OUTCOME_ERROR.STALL })),
      stallTimeoutMs
    );
    interrupt = (error) => { clearTimeout(timer); reject(error); };
    reader.read().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
  const onAbort = () => stop(Object.assign(new Error("request aborted"), { errorKind: OUTCOME_ERROR.ABORTED }));
  signal?.addEventListener?.("abort", onAbort, { once: true });

  const committed = (ended) => {
    outcomeTracker.commit();
    return { ok: true, reader, buffered, ended, outcome: outcomeTracker.snapshot() };
  };
  const failed = async (outcome) => {
    await reader.cancel(outcome.error).catch(() => {});
    return { ok: false, outcome };
  };

  try {
    while (true) {
      let result;
      try {
        result = await read();
      } catch (error) {
        if (signal?.aborted || error?.errorKind === OUTCOME_ERROR.ABORTED) {
          return { ok: false, outcome: outcomeTracker.abortClient("Request aborted") };
        }
        return { ok: false, outcome: outcomeTracker.fail(error?.errorKind || OUTCOME_ERROR.RESET, error?.message || "Upstream stream failed before output") };
      }

      if (result.done) {
        parseBuffer += decoder.decode();
        if (parseBuffer.trim()) parseSSEBlocks(`${parseBuffer}\n\n`, outcomeTracker.observe);
        const outcome = outcomeTracker.finish();
        return outcome.ok ? committed(true) : { ok: false, outcome };
      }

      buffered.push(result.value);
      bufferedBytes += result.value?.byteLength || 0;
      if (bufferedBytes > maxBufferedBytes) {
        return failed(outcomeTracker.fail(OUTCOME_ERROR.INVALID, "Upstream produced too much metadata before useful output"));
      }

      parseBuffer = parseSSEBlocks(parseBuffer + decoder.decode(result.value, { stream: true }), outcomeTracker.observe);
      const outcome = outcomeTracker.snapshot();
      if (outcome.terminalClass === "failure") return failed(outcome);
      if (outcome.terminalClass === "success") {
        const terminal = outcomeTracker.finish();
        if (!terminal.ok) return failed(terminal);
        return committed(false);
      }
      if (outcome.committableOutputSeen) return committed(false);
    }
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * Replay the bytes buffered by createPrecommitStream, then keep reading the same
 * upstream reader with normal backpressure.
 */
export function streamFromPrecommit({ reader, buffered, ended = false }) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < buffered.length) {
        controller.enqueue(buffered[index++]);
        return;
      }
      if (ended) {
        controller.close();
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Pass bytes through unchanged while feeding every SSE event to the tracker. */
export function createOutcomeTrackingStream(outcomeTracker) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer = parseSSEBlocks(buffer + decoder.decode(chunk, { stream: true }), outcomeTracker.observe);
      controller.enqueue(chunk);
    },
    flush() {
      buffer += decoder.decode();
      if (buffer.trim()) parseSSEBlocks(`${buffer}\n\n`, outcomeTracker.observe);
    },
  });
}
