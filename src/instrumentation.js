export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // App bootstrap belongs here, not in a page.
    //
    // It used to run as an import side effect of src/app/layout.js, which meant
    // it only fired once something RENDERED the dashboard. Backend-only mode
    // (2026-08-24) 404s every page before it renders, so initializeApp stopped
    // running entirely and took the tunnel watchdog, the token-refresh
    // scheduler and the context-window learner with it — silently, because
    // nothing logs the absence of work it never started.
    //
    // register() is the seam Next provides for exactly this: it runs once per
    // server process regardless of which routes are reachable. bootstrap.js is
    // already guarded by a global, so importing it from both places is safe
    // while the layout import remains.
    await import("@/shared/services/bootstrap");
  }
}
