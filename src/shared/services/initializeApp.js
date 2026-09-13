import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

process.setMaxListeners(20);

// Defer heavy startup work so the first HTTP request (login → dashboard) isn't
// starved by DB cleanup, lsof/DNS probes and OAuth pings.
const STARTUP_DEFER_MS = 3000;

// Survive Next.js hot reload
const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
};

export async function initializeApp() {
  try {
    // Register cleanup callback immediately so signals are handled even during
    // the deferred window.
    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try { killAllBridges(); } catch { /* best effort */ }
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      g.signalHandlersRegistered = true;
    }

    // Defer the heavy work — nothing here blocks incoming requests.
    setTimeout(() => {
      runHeavyStartup().catch((e) => console.error("[InitApp] deferred startup failed:", e.message));
    }, STARTUP_DEFER_MS);
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup() {
  await cleanupProviderConnections();
  const settings = await getSettings();

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }

  // Proactive OAuth token refresh (e.g. grok-cli ~6h TTL). Module is idempotent
  // and also started from custom-server.js when that entry is used.
  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

export default initializeApp;
