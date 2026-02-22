import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { killCloudflared, isCloudflaredRunning, ensureCloudflared } from "@/lib/tunnel/cloudflared";

// Multiple modules register SIGINT/SIGTERM handlers legitimately
process.setMaxListeners(20);

let signalHandlersRegistered = false;

/**
 * Initialize app on startup
 * - Cleanup stale data
 * - Auto-reconnect tunnel if previously enabled
 * - Register shutdown handler to kill cloudflared
 */
export async function initializeApp() {
  try {
    await cleanupProviderConnections();

    // Auto-reconnect tunnel if it was enabled before restart
    const settings = await getSettings();
    if (settings.tunnelEnabled && !isCloudflaredRunning()) {
      console.log("[InitApp] Tunnel was enabled, auto-reconnecting...");
      try {
        await enableTunnel();
        console.log("[InitApp] Tunnel reconnected");
      } catch (error) {
        console.log("[InitApp] Tunnel reconnect failed:", error.message);
      }
    }

    // Kill cloudflared on process exit (register once only)
    if (!signalHandlersRegistered) {
      const cleanup = () => {
        killCloudflared();
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      signalHandlersRegistered = true;
    }

    // Pre-download cloudflared binary in background
    ensureCloudflared().catch(() => {});
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

export default initializeApp;
