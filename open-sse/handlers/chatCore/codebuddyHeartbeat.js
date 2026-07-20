/**
 * CodeBuddy Heartbeat Module
 *
 * Implements state-of-the-art heartbeat mechanism for extended reasoning models.
 * Based on reverse-engineered CodeBuddy CLI (v2.106.3) behavior.
 *
 * Architecture:
 * - Upstream (CodeBuddy API) → [stall monitor 1200s] → Transform → [heartbeat injector 30s] → Client
 * - Upstream silence during reasoning is normal (3-10+ minutes)
 * - Heartbeat keeps client connection alive during upstream silence
 * - Stall timeout only fires if upstream truly dead (no data for 20 min)
 */

const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds (matches CodeBuddy CLI)
const CODEBUDDY_STALL_TIMEOUT_MS = 1200000; // 20 minutes (matches CodeBuddy CLI)
const HEARTBEAT_PAYLOAD = ": heartbeat\n\n"; // SSE comment format

/**
 * Check if provider needs heartbeat mechanism
 */
export function needsHeartbeat(provider) {
  return provider === "codebuddy";
}

/**
 * Get CodeBuddy-specific stall timeout
 */
export function getStallTimeout(provider) {
  return provider === "codebuddy" ? CODEBUDDY_STALL_TIMEOUT_MS : 180000; // 3min default
}

/**
 * CodeBuddy SSE headers - prevents proxy buffering and connection reclamation
 */
export function getCodeBuddySSEHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform", // no-transform prevents proxy compression
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no", // nginx: don't buffer, stream immediately
    "X-Proxy-Buffering": "no" // some proxies use this
  };
}

/**
 * Create heartbeat injector transform stream
 *
 * Injects SSE comment heartbeat every 30 seconds to keep client connection alive.
 * This is critical during extended reasoning phases where upstream goes silent.
 *
 * SSE comments (lines starting with ":") are ignored by SSE parsers but keep
 * the TCP connection alive through proxies and load balancers.
 */
export function createHeartbeatInjector() {
  let heartbeatTimer = null;
  let lastHeartbeatAt = 0;
  let heartbeatCount = 0;

  return new TransformStream({
    start(controller) {
      // Start heartbeat timer immediately
      heartbeatTimer = setInterval(() => {
        try {
          const now = Date.now();

          // Encode heartbeat as SSE comment
          const encoder = new TextEncoder();
          const heartbeatBytes = encoder.encode(HEARTBEAT_PAYLOAD);

          // Inject heartbeat into stream
          controller.enqueue(heartbeatBytes);

          heartbeatCount++;
          const timeSinceLast = now - lastHeartbeatAt;
          lastHeartbeatAt = now;

          // Log every heartbeat for visibility
          console.log(`[HEARTBEAT] 💓 #${heartbeatCount} (${Math.round(timeSinceLast / 1000)}s since last)`);
        } catch (err) {
          console.error("[HEARTBEAT] Failed to inject heartbeat:", err.message);
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },

    transform(chunk, controller) {
      // Pass through all upstream data unchanged
      controller.enqueue(chunk);
    },

    flush(controller) {
      // Clean up heartbeat timer when stream ends
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (heartbeatCount > 0) {
        console.log(`[HEARTBEAT] ✅ Stream complete, sent ${heartbeatCount} heartbeats total`);
      }
    },

    cancel() {
      // Clean up on stream cancellation
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  });
}

/**
 * Create upstream stall monitor
 *
 * Monitors upstream data flow with 1-second polling.
 * Throws error if no data received for stall timeout period.
 *
 * Key insight: Heartbeat is sent downstream (to client), but stall monitor
 * watches upstream (from CodeBuddy). These are independent.
 */
export function createStallMonitor(provider, model, stallTimeoutMs) {
  let lastDataAt = Date.now();
  let chunkCount = 0;
  let totalBytes = 0;
  let monitorTimer = null;

  return {
    /**
     * Call this on every upstream chunk received
     */
    onData(chunk) {
      lastDataAt = Date.now();
      chunkCount++;
      totalBytes += chunk.length;
    },

    /**
     * Start monitoring (call when stream begins)
     */
    start() {
      lastDataAt = Date.now();
      chunkCount = 0;
      totalBytes = 0;

      monitorTimer = setInterval(() => {
        const elapsed = Date.now() - lastDataAt;

        if (elapsed >= stallTimeoutMs) {
          const error = new Error(
            `Upstream stall timeout: no data for ${Math.round(elapsed / 1000)}s ` +
            `(timeout: ${stallTimeoutMs / 1000}s, chunks: ${chunkCount}, bytes: ${totalBytes})`
          );
          error.name = "UpstreamStallTimeout";
          error.code = "UPSTREAM_STALL";
          throw error;
        }
      }, 1000); // Check every 1 second
    },

    /**
     * Stop monitoring (call when stream ends)
     */
    stop() {
      if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
      }
    },

    /**
     * Get current stats
     */
    getStats() {
      return {
        chunkCount,
        totalBytes,
        timeSinceLastData: Date.now() - lastDataAt
      };
    }
  };
}
