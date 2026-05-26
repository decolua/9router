// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({
  onDisconnect,
  onError,
  log,
  provider,
  model,
} = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  const logStream = (status) => {
    const duration = Date.now() - startTime;
    const p = provider?.toUpperCase() || "UNKNOWN";
    console.log(
      `[${getTimeString()}] 🌊 [STREAM] ${p} | ${model || "unknown"} | ${duration}ms | ${status}`,
    );
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream(`disconnect: ${reason}`);
      dbg(
        "CTRL",
        `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`,
      );

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      logStream("complete");

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
        logStream("aborted");
        return;
      }

      logStream(`error: ${error.message}`);
      onError?.(error);
    },

    abort: () => abortController.abort(),
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
 */
export function createDisconnectAwareStream(
  transformStream,
  streamController,
  streamStateTracker = null,
  resumeCtx = null,
) {
  let reader = transformStream.readable.getReader();
  let writer = transformStream.writable
    ? transformStream.writable.getWriter()
    : { abort: () => Promise.resolve() };
  let resumeAttempts = 0;
  const maxResumeAttempts = 2;
  let chunksReceived = 0;

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          if (chunksReceived === 0) {
            throw new Error("API returned an empty response (HTTP 200)");
          }
          streamController.handleComplete();
          controller.close();
          return;
        }
        chunksReceived++;
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        const textBuffer = streamStateTracker;
        const hasGeneratedText =
          textBuffer &&
          (textBuffer.accumulatedContent || textBuffer.accumulatedThinking);
        const isEarlyStreamError = chunksReceived === 0;
        const canResume = hasGeneratedText || isEarlyStreamError;

        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkOrOverloadError =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          msg.includes("overloaded") ||
          msg.includes("overload") ||
          msg.includes("busy") ||
          msg.includes("empty response") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        if (
          wasConnected &&
          isNetworkOrOverloadError &&
          canResume &&
          resumeAttempts < maxResumeAttempts &&
          resumeCtx
        ) {
          resumeAttempts++;

          // Apply backoff strategy: 1st retry = immediate, 2nd retry = 1.5s delay
          if (resumeAttempts === 2) {
            console.log(
              `[RESUME] Applying backoff delay of 1.5s before attempt 2...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          console.log(
            `[RESUME] Mid-stream connection lost (${error.message}). Attempting transparent resume ${resumeAttempts}/${maxResumeAttempts}...`,
          );

          try {
            // Dynamic import to prevent circular dependencies
            const { executeResumeRequest } = await import("./streamResumer.js");

            const newResponse = await executeResumeRequest({
              originalBody: resumeCtx.body,
              textBuffer,
              provider: resumeCtx.provider,
              model: resumeCtx.model,
              credentials: resumeCtx.credentials,
              sourceFormat: resumeCtx.sourceFormat,
              targetFormat: resumeCtx.targetFormat,
              userAgent: resumeCtx.userAgent,
              apiKey: resumeCtx.apiKey,
              connectionId: resumeCtx.connectionId,
              toolNameMap: resumeCtx.toolNameMap,
              reqLogger: resumeCtx.reqLogger,
              clientRawRequest: resumeCtx.clientRawRequest,
            });

            if (newResponse) {
              console.log(
                "[RESUME] Resume request successful! Piping new stream chunks...",
              );

              chunksReceived = 0;
              await reader.cancel().catch(() => {});
              if (writer && typeof writer.abort === "function") {
                await writer.abort().catch(() => {});
              }

              const {
                createSSETransformStreamWithLogger,
                createPassthroughStreamWithLogger,
              } = await import("./stream.js");
              const { needsTranslation } =
                await import("../translator/index.js");

              let newTransformStream;
              if (
                needsTranslation(resumeCtx.targetFormat, resumeCtx.sourceFormat)
              ) {
                newTransformStream = createSSETransformStreamWithLogger(
                  resumeCtx.targetFormat,
                  resumeCtx.sourceFormat,
                  resumeCtx.provider,
                  resumeCtx.reqLogger,
                  resumeCtx.toolNameMap,
                  resumeCtx.model,
                  resumeCtx.connectionId,
                  resumeCtx.body,
                  null, // no need to re-trigger onStreamComplete
                  resumeCtx.apiKey,
                  textBuffer,
                );
              } else {
                newTransformStream = createPassthroughStreamWithLogger(
                  resumeCtx.provider,
                  resumeCtx.reqLogger,
                  resumeCtx.model,
                  resumeCtx.connectionId,
                  resumeCtx.body,
                  null,
                  resumeCtx.apiKey,
                  textBuffer,
                );
              }

              const upstreamTap = new TransformStream({
                transform(chunk, controller) {
                  controller.enqueue(chunk);
                },
              });

              const newTransformedBody = newResponse.body
                .pipeThrough(upstreamTap)
                .pipeThrough(newTransformStream);

              reader = newTransformedBody.getReader();
              writer = { abort: () => Promise.resolve() };

              // Read next chunks from the resumed stream!
              return this.pull(controller);
            }
          } catch (resumeErr) {
            console.error("[RESUME] Resume attempt failed:", resumeErr.message);
          }
        }

        streamController.handleError(error);
        reader.cancel().catch(() => {});
        if (writer && typeof writer.abort === "function") {
          writer.abort().catch(() => {});
        }

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

        if (!wasConnected || isNetworkClose) {
          try {
            controller.close();
          } catch (e) {
            // Stream might already be closed or cancelled
          }
        } else {
          try {
            controller.error(error);
          } catch (e) {
            /* already closed */
          }
        }
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      if (writer && typeof writer.abort === "function") {
        writer.abort();
      }
    },
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
 * @param {object} streamStateTracker - Stream state tracker to extract generated text
 * @param {object} resumeCtx - Context to resume the stream if connection breaks
 */
export function pipeWithDisconnect(
  providerResponse,
  transformStream,
  streamController,
  streamStateTracker = null,
  resumeCtx = null,
) {
  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      dbg(
        tag,
        `STALL TIMEOUT ${STREAM_STALL_TIMEOUT_MS}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`,
      );
      streamController.handleError?.(new Error("stream stall timeout"));
      streamController.abort?.();
    }, STREAM_STALL_TIMEOUT_MS);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => {
      dbg(
        tag,
        `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearStall();
      streamController.handleComplete();
    },
    handleError: (e) => {
      dbg(
        tag,
        `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearStall();
      streamController.handleError(e);
    },
    handleDisconnect: (r) => {
      dbg(
        tag,
        `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearStall();
      streamController.handleDisconnect(r);
    },
    abort: () => {
      clearStall();
      streamController.abort();
    },
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${STREAM_STALL_TIMEOUT_MS}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (
        isDebugEnabled &&
        (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)
      ) {
        dbg(
          tag,
          `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`,
        );
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() {
      dbg(
        tag,
        `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearStall();
    },
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    {
      readable: transformedBody,
      writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
    },
    wrappedController,
    streamStateTracker,
    resumeCtx,
  );
}
