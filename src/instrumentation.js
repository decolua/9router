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

    // Start quota-only polling before dashboard/auth traffic. No inference sent.
    try {
      const { getSettings } = await import("@/lib/localDb");
      const { configureAccountQuotaWindows } = await import("@/shared/services/accountQuotaWindows");
      configureAccountQuotaWindows(await getSettings());
    } catch (error) {
      console.warn("[AccountQuotaWindows] startup failed:", error.message);
    }
  }
}
