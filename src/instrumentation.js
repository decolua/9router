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

    // initializeApp starts the auto-ping scheduler, the Infisical seed and the
    // account repair. It was only imported by the root layout, so after a
    // restart none of them ran until someone rendered a page — scheduled
    // keepalives silently stopped on every redeploy. Guarded, so the layout's
    // import stays a no-op; heavy work is deferred, so this does not block boot.
    await import("@/shared/services/bootstrap");
  }
}
