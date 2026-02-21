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

// Auto-initialize when module loads
ensureAppInitialized().catch(console.log);

export default ensureAppInitialized;
