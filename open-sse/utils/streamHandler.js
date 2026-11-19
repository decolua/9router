import { STREAM_FIRST_CHUNK_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { STREAM_FAILURE_MESSAGES } from "../config/errorConfig.js";
import { dbg } from "./debugLog.js";
import { describeUpstreamDisconnect } from "./error.js";

export function createStreamController({ onDisconnect, onComplete, onError, log, provider, model, reqTag = "", signal: clientSignal } = {}) {
  const controller = new AbortController();
  const signal = clientSignal ? AbortSignal.any([clientSignal, controller.signal]) : controller.signal;
  const startTime = Date.now();
  let settled = false;

  return {
    signal,
    startTime,
    isConnected: () => !settled && !signal.aborted,
    handleDisconnect(reason = "client_closed") {
      if (settled) return;
      settled = true;
      const duration = Date.now() - startTime;
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${duration}ms`);
      log?.line?.(reqTag, "✗", `DOWNSTREAM CANCELLED · ${provider}/${model} · ${duration}ms`);
      controller.abort();
      onDisconnect?.({ reason, duration });
    },
    handleComplete() {
      if (settled) return;
      settled = true;
      onComplete?.();
    },
    handleError(error) {
      if (settled) return;
      settled = true;
      const message = `UPSTREAM ERROR: ${error?.message || String(error)} · ${provider}/${model} · ${Date.now() - startTime}ms`;
      if (log?.errorLine) log.errorLine(reqTag, "✗", message);
      else console.warn(`[STREAM] ${message}`);
      onError?.(error);
    },
    abort: (reason) => controller.abort(reason),
  };
}

function cancelReader(reader, reason) {
  try { void reader.cancel(reason).catch(() => {}); }
  catch { /* a closed transform can throw synchronously on cancel */ }
  finally { reader.releaseLock(); }
}

export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null) {
  const reader = transformStream.readable.getReader();
  const { signal } = streamController;
  let finished = false;
  let downstream;
  const release = (cancel, reason) => {
    if (finished) return false;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    if (cancel) cancelReader(reader, reason);
    else reader.releaseLock();
    return true;
  };
  const disconnect = (reason, close) => {
    if (!release(true, reason)) return;
    streamController.handleDisconnect(reason);
    if (close) downstream.close();
  };
  const onAbort = () => disconnect("client_closed", true);

  return new ReadableStream({
    start(controller) {
      downstream = controller;
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      if (!streamController.isConnected()) { onAbort(); return; }
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          release(false);
          streamController.handleComplete();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        if (!release(true, error)) return;
        if (signal?.aborted) {
          streamController.handleDisconnect("client_closed");
          controller.close();
          return;
        }
        streamController.handleError(error);
        if (onAbortTerminal) {
          const bytes = onAbortTerminal(error);
          if (bytes) controller.enqueue(bytes);
          controller.close();
        } else if (/abort|closed|terminated|socket hang up|econnreset/i.test(error?.message) || error?.cause?.code === "UND_ERR_SOCKET") {
          controller.close();
        } else controller.error(error);
      }
    },
    cancel(reason) { disconnect(reason || "cancelled", false); },
  }, { highWaterMark: 0 });
}

/** Observe real upstream reads. The first-output deadline, byte-inactivity deadline,
 * and terminal grace window own separate phases. Downstream backpressure does not arm the stall timer. */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS) {
  const reader = providerResponse.body.getReader();
  const { signal } = streamController;
  let upstream;
  let stopped = false;
  let settled = false;
  let waitingForTrailer = false;
  let firstTimer;
  let stallTimer;
  let firstRead = true;
  let outputSeen = !transformStream.setStreamLifecycle;

  const clearTimers = () => {
    clearTimeout(firstTimer);
    clearTimeout(stallTimer);
  };
  const release = (cancel, reason) => {
    if (stopped) return false;
    stopped = true;
    clearTimers();
    if (cancel) cancelReader(reader, reason);
    else reader.releaseLock();
    return true;
  };
  const endUpstream = (error, cancel = false) => {
    if (!release(cancel, error)) return;
    if (error) {
      if (!transformStream.setUpstreamFailure) { upstream.error(error); return; }
      // An errored pipe discards queued output. Close normally and let the
      // transform decide from the frames already parsed whether it finished.
      transformStream.setUpstreamFailure(error);
    }
    upstream.close();
  };
  const settle = (callback) => {
    if (settled) return;
    settled = true;
    clearTimers();
    transformStream.clearCompletionTimer?.();
    callback();
  };
  const wrappedController = {
    signal,
    isConnected: () => !signal?.aborted && (settled || streamController.isConnected()),
    handleComplete: () => settle(() => streamController.handleComplete()),
    handleError: (error) => settle(() => streamController.handleError(error)),
    handleDisconnect: (reason) => {
      release(true, reason);
      settle(() => streamController.handleDisconnect(reason));
    },
  };

  const input = new ReadableStream({
    start(controller) { upstream = controller; },
    async pull(controller) {
      if (firstRead && !outputSeen) {
        firstTimer = setTimeout(() => endUpstream(new Error(STREAM_FAILURE_MESSAGES.firstOutput), true), STREAM_FIRST_CHUNK_TIMEOUT_MS);
      }
      firstRead = false;
      if (outputSeen && !waitingForTrailer) {
        stallTimer = setTimeout(() => endUpstream(new Error(STREAM_FAILURE_MESSAGES.stall), true), stallTimeoutMs);
      }
      try {
        const { done, value } = await reader.read();
        if (stopped) return;
        if (done) endUpstream();
        else controller.enqueue(value);
      } catch (error) { endUpstream(error); }
      finally { clearTimeout(stallTimer); }
    },
    cancel(reason) { release(true, reason); },
  }, { highWaterMark: 0 });

  transformStream.setStreamLifecycle?.({
    endUpstream: () => endUpstream(undefined, true),
    onOutput: () => { outputSeen = true; clearTimeout(firstTimer); },
    onTerminalGrace: () => { waitingForTrailer = true; clearTimers(); },
    onSettled: (error) => error ? wrappedController.handleError(error) : wrappedController.handleComplete(),
  });
  return createDisconnectAwareStream(
    { readable: input.pipeThrough(transformStream, { signal }) }, wrappedController,
    onAbortTerminal && ((error) => transformStream.hasTerminal?.()
      ? null
      : onAbortTerminal(describeUpstreamDisconnect(error), transformStream.getResponseId?.(), error)),
  );
}

const HEARTBEAT = new TextEncoder().encode(": keepalive\n\n");

/** Downstream-only comments at SSE event boundaries, after usable output. */
export function withSseHeartbeat(body, intervalMs, signal, hasOutput) {
  const reader = body.getReader();
  let lineEmpty = true;
  let atBoundary = false;
  let pending;
  let next;
  let wake;
  let timer;
  let onAbort;
  let finished = false;
  const received = (result) => { next = result; wake?.(); };
  const cleanup = () => {
    if (finished) return false;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    wake?.();
    return true;
  };

  return new ReadableStream({
    start(controller) {
      onAbort = () => {
        if (!cleanup()) return;
        cancelReader(reader, signal.reason);
        controller.close();
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      pending ||= reader.read().then((result) => received({ result }), (error) => received({ error }));
      if (!next) await new Promise((resolve) => {
        wake = resolve;
        if (atBoundary && hasOutput()) timer = setTimeout(resolve, intervalMs);
      });
      clearTimeout(timer);
      wake = null;
      if (finished) return;
      if (!next) { controller.enqueue(HEARTBEAT); return; }

      const { result, error } = next;
      pending = next = null;
      if (!result || result.done) {
        cleanup();
        reader.releaseLock();
        if (result) controller.close();
        else controller.error(error);
        return;
      }
      for (const byte of result.value) {
        if (byte === 10) { atBoundary = lineEmpty; lineEmpty = true; }
        else if (byte !== 13) { atBoundary = false; lineEmpty = false; }
      }
      controller.enqueue(result.value);
    },
    cancel(reason) { if (cleanup()) cancelReader(reader, reason); },
  }, { highWaterMark: 0 });
}
