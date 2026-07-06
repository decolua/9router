// Next.js / vinext instrumentation entry.
//
// `register()` runs once on server startup — the canonical place for one-time
// initialization. Moved here from the root layout's side-effect imports because
// those imports (bootstrap → initializeApp → tunnel/cloudflared) call node:os at
// module top level; vinext includes the layout in the client bundle (it renders
// client providers) and would pull those server-only modules into the browser.
// instrumentation.js is server-only by design, so the init is safe here.

export async function register() {
  // Skip during build/prerender — bootstrap would download cloudflared, init DNS, etc.
  const isBuildPhase =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export" ||
    process.env.NEXT_PHASE === "phase-static";
  if (isBuildPhase) return;

  // Hook console capture early (server-side only).
  const { initConsoleLogCapture } = await import("./lib/consoleLogBuffer.js");
  initConsoleLogCapture();

  // Initialize outbound proxy env (setImmediate-deferred inside).
  await import("./lib/network/initOutboundProxy.js");

  if (!global.__appBootstrapped) {
    global.__appBootstrapped = true;
    const { default: initializeApp } = await import("./shared/services/initializeApp.js");
    initializeApp().catch((e) => console.error("[Bootstrap] init failed:", e.message));
  }
}
