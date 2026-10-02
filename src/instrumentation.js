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

    // agents-b: respawn wrapper loop slot setelah restart (fail-open, file-based).
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      try {
        const { bootAgents } = await import("@/lib/agents/runner");
        bootAgents();
      } catch (e) {
        console.error("[agents] boot skipped:", e?.message || e);
      }
    }
  }
}
