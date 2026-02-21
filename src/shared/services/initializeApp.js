import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { killCloudflared, isCloudflaredRunning, ensureCloudflared } from "@/lib/tunnel/cloudflared";

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

    // Kill cloudflared on process exit
    const cleanup = () => {
      killCloudflared();
      process.exit();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Pre-download cloudflared binary in background
    ensureCloudflared().catch(() => {});
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

export default initializeApp;
