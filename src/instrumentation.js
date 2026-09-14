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

    // Load user contextWindow overrides into the capabilities resolver so
    // /v1/models + request routing honor dashboard edits from boot.
    try {
      const [{ getSettings }, { setContextWindowOverrides }] = await Promise.all([
        import("@/lib/db/repos/settingsRepo.js"),
        import("open-sse/providers/capabilities.js"),
      ]);
      const settings = await getSettings();
      setContextWindowOverrides(settings.contextWindowOverrides || {});
    } catch (e) {
      console.warn("[context-overrides] boot load failed:", e?.message);
    }
  }
}
