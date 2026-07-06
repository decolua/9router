/**
 * Centralized Shutdown Coordinator
 *
 * Goal: Reduce race conditions and duplicate process.exit() calls during shutdown.
 *
 * This is a Phase 5 improvement for long-running stability.
 *
 * Usage:
 *   import { registerCleanup, shutdown } from "@/lib/shutdownCoordinator.js";
 *
 *   registerCleanup("my-cleanup", async () => { ... }, 10);
 *
 *   // In signal handlers:
 *   process.on("SIGTERM", () => shutdown("SIGTERM"));
 */

const cleanups = [];

let isShuttingDown = false;

/**
 * Register a cleanup function.
 * @param {string} name - Human readable name for logging
 * @param {Function} fn - async or sync function
 * @param {number} priority - Lower numbers run first (default 10)
 */
export function registerCleanup(name, fn, priority = 10) {
  if (typeof fn !== "function") {
    throw new Error(`registerCleanup: fn must be a function for "${name}"`);
  }
  cleanups.push({ name, fn, priority });
  // Keep sorted so lower priority runs first
  cleanups.sort((a, b) => a.priority - b.priority);
}

/**
 * Run all registered cleanups in priority order.
 * Safe to call multiple times (idempotent).
 */
export async function shutdown(reason = "unknown") {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[ShutdownCoordinator] Shutdown initiated. Reason: ${reason}`);

  for (const { name, fn } of cleanups) {
    try {
      console.log(`[ShutdownCoordinator] Running cleanup: ${name}`);
      await Promise.race([
        Promise.resolve(fn()),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 8000)
        ),
      ]);
    } catch (err) {
      console.error(`[ShutdownCoordinator] Cleanup "${name}" failed:`, err.message);
    }
  }

  console.log("[ShutdownCoordinator] All cleanups completed.");
}

/**
 * Check if shutdown has been triggered.
 */
export function isShutdownInProgress() {
  return isShuttingDown;
}

// Auto-register some core cleanups that used to be scattered
// (We will gradually move more things here over time)
if (typeof process !== "undefined") {
  // Prevent double registration if module is reloaded
  if (!global.__shutdownCoordinatorRegistered) {
    global.__shutdownCoordinatorRegistered = true;

    // Example: we can later move DNS + cloudflared cleanup here
    // For now this module just provides the infrastructure.
  }
}