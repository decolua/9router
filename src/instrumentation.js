export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // App lifecycle (webhook dispatcher, tunnel watchdog, background schedulers)
    // must start with the Node server, not with the first page render. Standalone
    // deployments can serve prerendered pages without evaluating the root layout
    // module that imports bootstrap.js, which leaves the dispatcher unstarted.
    // bootstrap.js keeps the build-phase guard and the singleton/HMR guard.
    try {
      await import("@/shared/services/bootstrap.js");
    } catch (error) {
      console.error("[Instrumentation] app bootstrap failed:", error?.message);
    }

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
