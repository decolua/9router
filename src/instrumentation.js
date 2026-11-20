export async function register() {
  const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
  initConsoleLogCapture();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
