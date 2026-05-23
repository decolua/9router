// Next.js instrumentation hook — runs once when the server starts.
// Used to bootstrap the OAuth token-refresh background worker so idle
// connections get refreshed before they hit upstream as expired.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const mod = await import("./shared/services/initializeApp.js");
    await mod.default();
  } catch (err) {
    console.warn("[instrumentation] initializeApp failed:", err?.message || err);
  }
}
