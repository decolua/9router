import { cleanupProviderConnections } from "@/lib/localDb";

/**
 * Initialize cloud sync scheduler
 */
export async function initializeCloudSync() {
  try {
    // Cleanup null fields from existing data
    await cleanupProviderConnections();
    
    // Cloud sync via scheduler is currently disabled (replaced by Tunnel)
    return null;
  } catch (error) {
    console.error("[CloudSync] Error initializing scheduler:", error);
    throw error;
  }
}

export default initializeCloudSync;
