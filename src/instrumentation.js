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

    // FED-013: belt-and-suspenders loop starter for the `next start` path
    // (custom-server.js is the primary entry; both call into the
    // double-start-guarded startFederationLoops, so firing from both is
    // safe). Dynamic import + fail-open: standalone/central deployments and
    // images without the federation modules must boot unchanged.
    const mode = String(process.env.FEDERATION_MODE || "").trim().toLowerCase();
    if (mode === "edge") {
      // FED-014: the edge proxy / DEGRADED intercept live ONLY in
      // custom-server.js (the http.createServer wrapper). instrumentation.js
      // can start the replication/failover loops but cannot install that
      // wrapper — so an edge booted via plain `next start` (or any path that
      // skips custom-server.js) would silently serve zero federation
      // behavior. Fail LOUD (never throw): tell the operator exactly how to
      // boot correctly. Standalone/central stay silent (zero drift).
      if (!globalThis.__9ROUTER_CUSTOM_SERVER__) {
        console.error(
          "[federation] WARNING: FEDERATION_MODE=edge but the custom-server.js wrapper is NOT active — " +
            "the edge proxy and DEGRADED intercept are DISABLED. " +
            "Start with `npm start` (boots custom-server.js), not `next start`."
        );
      }
      try {
        const { startFederationLoops } = await import("@/lib/federation/startLoops");
        await startFederationLoops();
      } catch (e) {
        console.error("[federation] loop starter failed:", e && e.message ? e.message : e);
      }
    }
  }
}
