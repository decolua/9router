/**
 * CodeBuddy Heartbeat Stream — State-of-the-art keep-alive for extended reasoning models.
 *
 * Reverse-engineered from official CodeBuddy CLI (v2.106.3):
 * - 30-second SSE comment heartbeat (`: heartbeat\n\n`)
 * - Prevents reverse proxy connection reclamation (nginx, cloudflared)
 * - Resets upstream stall timer on each heartbeat send
 * - Tracks activity for diagnostics
 *
 * Why this matters for Claude Opus 4.7:
 * - Extended reasoning phases can go 3-10+ minutes without output
 * - Without heartbeat, proxies see idle connection and close it
 * - SSE comments are ignored by parsers but keep TCP connection alive
 * - CodeBuddy CLI uses 20-minute timeout + 30s heartbeat for this exact scenario
 *
 * @module codebuddyHeartbeat
 */

const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds (matches CodeBuddy CLI)
const HEARTBEAT_PAYLOAD = ": heartbeat\n\n"; // SSE comment format

/**
 * Get HH:MM:SS timestamp for logging
 */
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/**
 * Create a heartbeat stream wrapper for CodeBuddy provider.
 *
 * Injects SSE comment heartbeats every 30 seconds during upstream silence.
 * Calls resetStallTimer on each heartbeat to prevent false stall timeouts
 * during extended reasoning phases (Claude Opus 4.7 thinking mode).
 *
 * Architecture:
 * ```
 * upstream (CodeBuddy API)
 *   ↓ SSE data
 * upstreamTap (stall timer: 1200s)
 *   ↓ transformed chunks
 * transformStream (format translation)
 *   ↓ transformed chunks
 * heartbeatStream (this) ← injects ": heartbeat\n\n" every 30s
 *   ↓ mixed chunks + heartbeats
 * client (Claude Code, Cursor, etc.)
 * ```
 *
 * @param {ReadableStream} transformedBody - Output from pipeWithDisconnect
 * @param {Function} resetStallTimer - Callback to reset upstream stall timer
 * @param {Object} options - Configuration
 * @param {string} options.provider - Provider name (for logging)
 * @param {string} options.model - Model name (for logging)
 * @returns {ReadableStream} Stream with injected heartbeats
 */
export function createCodeBuddyHeartbeatStream(transformedBody, resetStallTimer, { provider, model } = {}) {
  const reader = transformedBody.getReader();
  let heartbeatTimer = null;
  let heartbeatCount = 0;
  let totalBytes = 0;
  let chunkCount = 0;
  const startTime = Date.now();

  const startHeartbeat = (controller) => {
    heartbeatTimer = setInterval(() => {
      try {
        // Inject SSE comment heartbeat
        controller.enqueue(new TextEncoder().encode(HEARTBEAT_PAYLOAD));

        // Reset upstream stall timer (prevents 1200s timeout during reasoning)
        if (resetStallTimer) resetStallTimer();

        heartbeatCount++;
        totalBytes += HEARTBEAT_PAYLOAD.length;

        // Log heartbeat activity (first 3, then every 10th)
        if (heartbeatCount <= 3 || heartbeatCount % 10 === 0) {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[${getTimeString()}] 💓 [HEARTBEAT] ${provider?.toUpperCase()} | ${model} | ` +
            `#${heartbeatCount} | ${duration}s elapsed | ${chunkCount} chunks`
          );
        }
      } catch (err) {
        // Stream closed or errored, stop heartbeat
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  return new ReadableStream({
    async start(controller) {
      // Start heartbeat timer immediately (don't wait for first chunk)
      startHeartbeat(controller);
    },

    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Upstream exhausted — clean shutdown
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          controller.close();

          // Final stats
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[${getTimeString()}] ✅ [HEARTBEAT] ${provider?.toUpperCase()} | ${model} | ` +
            `Complete: ${chunkCount} chunks + ${heartbeatCount} heartbeats | ${duration}s`
          );
          return;
        }

        // Track upstream chunk activity
        chunkCount++;
        totalBytes += value.byteLength || value.length || 0;
        controller.enqueue(value);
      } catch (err) {
        // Upstream error — cleanup and propagate
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        controller.error(err);
      }
    },

    cancel(reason) {
      // Client disconnected — cleanup heartbeat timer
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      reader.cancel(reason);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[${getTimeString()}] ⚠️ [HEARTBEAT] ${provider?.toUpperCase()} | ${model} | ` +
        `Cancelled: ${reason || 'unknown'} | ${chunkCount} chunks + ${heartbeatCount} heartbeats | ${duration}s`
      );
    }
  });
}

/**
 * CodeBuddy-specific SSE response headers.
 *
 * Based on CodeBuddy CLI headers that prevent proxy buffering and connection reclamation:
 * - X-Accel-Buffering: no → nginx streams immediately (no buffering)
 * - Cache-Control: no-cache, no-transform → prevents proxy compression/transformation
 * - Connection: keep-alive → explicit keep-alive signal
 *
 * @type {Object}
 */
export const CODEBUDDY_SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform", // no-transform prevents proxy compression
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
  "X-Accel-Buffering": "no", // nginx: stream immediately, don't buffer
  "X-Content-Type-Options": "nosniff" // prevent MIME type sniffing
};

/**
 * Check if provider requires heartbeat mechanism.
 * Currently only CodeBuddy (extended reasoning models).
 *
 * @param {string} provider - Provider name
 * @returns {boolean}
 */
export function needsHeartbeat(provider) {
  return provider === "codebuddy";
}
