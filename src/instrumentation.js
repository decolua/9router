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

    // Daily auto check-in (opt-in). Wired HERE rather than only in
    // initializeApp's bootstrap because that bootstrap is reached through
    // src/app/layout.js — i.e. it only ever runs when a PAGE is rendered.
    // A gateway that serves API traffic exclusively (no one opening the
    // dashboard) would never render a page, so an API-only deployment would
    // silently never check in. `register()` is Next's documented Node-runtime
    // server hook and always runs once at boot, which is exactly the guarantee
    // a daily scheduler needs.
    try {
      const { getSettings } = await import("@/lib/localDb");
      const settings = await getSettings();
      // NOTE: process.stdout.write, not console.log — initConsoleLogCapture()
      // above patches console.* into an in-memory ring buffer (for the dashboard
      // log viewer), so scheduler diagnostics written with console.log are
      // INVISIBLE in `docker logs`. That cost real debugging time.
      if (settings.autoCheckin?.enabled === true) {
        const { configureCheckinScheduler } = await import("@/shared/services/checkinScheduler");
        configureCheckinScheduler(settings);
      }
    } catch (error) {
      // Fail-open: a check-in problem must never stop the gateway from booting.
      process.stdout.write(`[Checkin] instrumentation start skipped: ${error?.message || error}\n`);
    }
  }
}
