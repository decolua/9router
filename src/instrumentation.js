const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    if (isBuildPhase) return;

    try {
      const { getSettings } = await import("@/lib/localDb");
      const { hasQuotaAutoPingEnabled } = await import("@/shared/services/quotaStagger.js");
      const settings = await getSettings();
      if (!hasQuotaAutoPingEnabled(settings)) return;

      const { configureQuotaAutoPing } = await import("@/shared/services/quotaAutoPing.js");
      configureQuotaAutoPing(settings);
    } catch (e) {
      console.warn("[AutoPing] instrumentation start failed:", e.message);
    }
  }
}
