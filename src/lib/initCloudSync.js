import initializeApp from "@/shared/services/initializeApp";

// Survive Next.js HMR — module-level flag resets on reload, globalThis persists
const g = globalThis.__cloudSyncInit ??= { initialized: false, inProgress: null };

export async function ensureAppInitialized() {
  if (g.initialized) return true;
  if (g.inProgress) return g.inProgress;
  g.inProgress = (async () => {
    try {
      await initializeApp();
      g.initialized = true;
    } catch (error) {
      console.error("[ServerInit] Error initializing app:", error);
    } finally {
      g.inProgress = null;
    }
    return g.initialized;
  })();
  return g.inProgress;
}

// Auto-initialize at runtime only, not during next build.
// Defer to next tick so HTTP server can accept connections before heavy init runs.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  setImmediate(() => {
    ensureAppInitialized().catch(console.log);
  });
}

export default ensureAppInitialized;
