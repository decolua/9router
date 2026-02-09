import * as log from "../utils/logger.js";

const RETENTION_DAYS = 7;

/**
 * Cleanup old machine data from D1
 * Runs daily via cron trigger
 */
export async function handleCleanup(env) {
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  
  log.info("CLEANUP", `Deleting records older than ${cutoffDate}`);
  
  try {
    const result = await env.DB.prepare("DELETE FROM machines WHERE updatedAt < ?")
      .bind(cutoffDate)
      .run();
    
    log.info("CLEANUP", `Deleted ${result.meta?.changes || 0} old records`);
    
    return {
      success: true,
      deleted: result.meta?.changes || 0,
      cutoffDate
    };
  } catch (error) {
    log.error("CLEANUP", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

