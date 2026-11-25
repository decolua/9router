export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();
    if (!["phase-production-build", "phase-export", "phase-static"].includes(process.env.NEXT_PHASE)) {
      const { initDb } = await import("@/lib/db/index.js");
      const { startNotifications } = await import("@/lib/notifications/scheduler");
      try {
        await initDb(); // Run retention before serving, even when the gateway is idle.
      } catch (error) {
        const { FATAL_DB_STARTUP } = await import("@/lib/db/fatalStartupError.js");
        if (process.env.NODE_ENV === "production" && error?.code === FATAL_DB_STARTUP) {
          // Flush the redacted diagnostic to the service journal before exiting.
          const { writeSync } = await import("node:fs");
          const { redactLogValue } = await import("@/lib/observability/logPrivacy.js");
          try { writeSync(2, `[startup] Fatal database error: ${redactLogValue(error.message)}; exiting (1)\n`); }
          finally { process.exit(1); }
        }
        throw error;
      }
      startNotifications();
    }

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
