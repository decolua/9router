export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // FED-013: belt-and-suspenders loop starter for the `next start` path
    // (custom-server.js is the primary entry; both call into the
    // double-start-guarded startFederationLoops, so firing from both is
    // safe). Dynamic import + fail-open: standalone/central deployments and
    // images without the federation modules must boot unchanged.
    const mode = String(process.env.FEDERATION_MODE || "").trim().toLowerCase();
    if (mode === "edge") {
      try {
        const { startFederationLoops } = await import("@/lib/federation/startLoops");
        await startFederationLoops();
      } catch (e) {
        console.error("[federation] loop starter failed:", e && e.message ? e.message : e);
      }
    }
  }
}
