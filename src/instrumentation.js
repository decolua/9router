export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Upstream parity (v0.5.69): serve the synced model catalog to the
    // dashboard's capabilities page (server-only install, no node:fs in
    // the browser bundle) + background catalog sync.
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
      // FED-018: `next dev` can NEVER install the custom-server.js http
      // wrapper — the edge proxy and DEGRADED intercept live ONLY there, and
      // the Next.js dev server is its own process that never loads it. An
      // edge booted under `npm run dev` would silently serve zero federation
      // proxy behavior (loops start, proxy does not) — a broken edge that
      // looks healthy. Fail FATAL on dev-mode edge boots with a clear
      // remediation message. Production boots (npm run build && npm start →
      // custom-server.js) are unaffected; standalone/central stay silent
      // (zero drift).
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[federation] FATAL: FEDERATION_MODE=edge cannot run under `next dev` — " +
            "the edge proxy and DEGRADED intercept live only in custom-server.js, " +
            "which the Next.js dev server never loads. " +
            "Build and start the production server instead: `npm run build && npm start` " +
            "(or `docker compose -f docker-compose.federation.yml up`)."
        );
        process.exit(1);
        return;
      }
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
