/* ========== CLOUD SYNC — COMMENTED OUT (replaced by Tunnel) ==========
import { getCloudSyncScheduler } from "@/shared/services/cloudSyncScheduler";
========== END CLOUD SYNC ========== */
import { cleanupProviderConnections } from "@/lib/localDb";

/**
 * Initialize cloud sync scheduler
 * This should be called when the application starts
 */
export async function initializeCloudSync() {
  try {
    // Cleanup null fields from existing data
    await cleanupProviderConnections();
    
    /* ========== CLOUD SYNC — COMMENTED OUT (replaced by Tunnel) ==========
    // Create scheduler instance with default 15-minute interval
    const scheduler = await getCloudSyncScheduler(null, 15);
    
    // Start the scheduler
    await scheduler.start();
    
    return scheduler;
    ========== END CLOUD SYNC ========== */
    return null;
  } catch (error) {
    console.error("[CloudSync] Error initializing scheduler:", error);
    throw error;
  }
}

// For development/testing purposes
if (typeof require !== "undefined" && require.main === module) {
  initializeCloudSync().catch(console.log);
}

export default initializeCloudSync;

