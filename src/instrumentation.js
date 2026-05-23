// Next.js instrumentation hook — runs once when the server starts.
// Used to bootstrap initializeApp() (token-refresh worker, watchdog,
// network monitor, MITM auto-start, tunnel auto-resume) so background
// jobs run without waiting for the first request.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Notes:
//  - Skipped on edge runtime (only nodejs has fs/sqlite/etc).
//  - initializeApp itself is idempotent via global.__appSingleton, so
//    multiple invocations during HMR / route compile are safe.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Singleton guard — Next may import this hook from multiple places
  // (e.g. middleware + node runtime). Only the first one should bootstrap.
  if (globalThis.__9routerBootstrapInvoked) {
    return;
  }
  globalThis.__9routerBootstrapInvoked = true;

  console.log("[bootstrap] instrumentation.register() invoked");
  try {
    const mod = await import("./shared/services/initializeApp.js");
    await mod.default();
    console.log("[bootstrap] initializeApp completed");
  } catch (err) {
    console.warn("[bootstrap] initializeApp failed:", err?.message || err);
    // Allow a retry on next server start by clearing the guard.
    globalThis.__9routerBootstrapInvoked = false;
  }
}
