// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

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
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null, onCleanup = null) {
  let reader;
  let writer;
  try {
    reader = transformStream.readable.getReader();
    writer = transformStream.writable.getWriter();
  } catch (error) {
    onCleanup?.(error);
    throw error;
  }
  let terminalEmitted = false;
  let cleanupPromise = null;
  const cleanup = (reason) => {
    if (cleanupPromise) return cleanupPromise;
    const cancel = reader.cancel(reason).catch(error => console.warn(`[STREAM] reader cancellation failed: ${error?.message || "unknown error"}`));
    const abort = writer.abort(reason).catch(error => console.warn(`[STREAM] writer abort failed: ${error?.message || "unknown error"}`));
    try { reader.releaseLock?.(); } catch (error) { console.warn(`[STREAM] reader lock release failed: ${error?.message || "unknown error"}`); }
    try { writer.releaseLock?.(); } catch (error) { console.warn(`[STREAM] writer lock release failed: ${error?.message || "unknown error"}`); }
    const upstream = Promise.resolve(onCleanup?.(reason)).catch(error => console.warn(`[STREAM] upstream cleanup failed: ${error?.message || "unknown error"}`));
    cleanupPromise = Promise.all([cancel, abort, upstream]);
    return cleanupPromise;
  };

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  const output = new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        await cleanup("disconnected");
        emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          try { reader.releaseLock?.(); } catch (error) { console.warn(`[STREAM] reader lock release failed: ${error?.message || "unknown error"}`); }
          try { writer.releaseLock?.(); } catch (error) { console.warn(`[STREAM] writer lock release failed: ${error?.message || "unknown error"}`); }
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
        await cleanup(error);

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

    async cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      await cleanup(reason);
    }
  });
  output.cleanup = cleanup;
  return output;
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
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS, lifecycle = {}) {
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
      failWatchdog();
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); lifecycle.onComplete?.(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); lifecycle.onError?.(e); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); lifecycle.onDisconnect?.(r); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); streamController.abort(); }
  };
  let cleanupOwned = null;
  const failWatchdog = () => {
    const error = new Error("stream stall timeout");
    wrappedController.handleError(error);
    wrappedController.abort();
    cleanupOwned?.(error).catch(error => console.warn(`[STREAM] watchdog cleanup failed: ${error?.message || "unknown error"}`));
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

  let upstreamReader;
  let upstreamCleanupPromise = null;
  const cleanupOwnedReadable = (reason) => {
    if (upstreamCleanupPromise) return upstreamCleanupPromise;
    clearStall();
    const cancel = upstreamReader?.cancel(reason).catch(error => console.warn(`[STREAM] upstream cancellation failed: ${error?.message || "unknown error"}`));
    try { upstreamReader?.releaseLock(); } catch {}
    upstreamCleanupPromise = Promise.resolve(cancel);
    return upstreamCleanupPromise;
  };
  cleanupOwned = cleanupOwnedReadable;

  try {
    upstreamReader = providerResponse.body.getReader();
    const ownedReadable = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) {
            try { upstreamReader.releaseLock(); } catch (error) { console.warn(`[STREAM] upstream reader lock release failed: ${error?.message || "unknown error"}`); }
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return cleanupOwnedReadable(reason);
      },
    });
    const transformedBody = ownedReadable
      .pipeThrough(upstreamTap)
      .pipeThrough(transformStream);
    return createDisconnectAwareStream(
      { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      wrappedController,
      onAbortTerminal ? () => onAbortTerminal(abortMessage) : null,
      cleanupOwnedReadable
    );
  } catch (error) {
    cleanupOwnedReadable(error).catch(error => console.warn(`[STREAM] construction cleanup failed: ${error?.message || "unknown error"}`));
    wrappedController.handleError(error);
    throw error;
  }
}

