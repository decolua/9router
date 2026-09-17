export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // FIRST: own SIGINT/SIGTERM before anything can serve a request.
    // custom-server.js sets NEXT_MANUAL_SIG_HANDLE=1 and the SQLite adapters no
    // longer exit on signals, so whoever gets here first is the only chance to
    // drain in-flight usage writes. initializeApp() runs from the dashboard
    // layout, i.e. never in a gateway-only process that only serves /v1/* —
    // installing here covers that process too. The call is additive: the tunnel
    // and DNS teardown still register their cleanup when initializeApp runs.
    const { installShutdownCoordinator } = await import("@/shared/services/shutdownCoordinator.js");
    installShutdownCoordinator();

    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    const { startConnectionCatalogSync } = await import("@/lib/modelSync/scheduler.js");
    startConnectionCatalogSync();
  }
}
