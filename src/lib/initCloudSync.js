import initializeApp from "@/shared/services/initializeApp";

let initialized = false;

export async function ensureAppInitialized() {
  if (!initialized) {
    try {
      await initializeApp();
      initialized = true;
    } catch (error) {
      console.error("[ServerInit] Error initializing app:", error);
    }
  }
  return initialized;
}

// Auto-initialize only in production runtime (not during build)
if (process.env.NODE_ENV === 'production' && typeof window === 'undefined') {
  ensureAppInitialized().catch(console.log);
}

export default ensureAppInitialized;
