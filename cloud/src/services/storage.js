import * as log from "../utils/logger.js";

// Request-scoped cache for getMachineData (avoids multiple D1 queries per request)
const requestCache = new Map();
const CACHE_TTL_MS = 5000;

/**
 * Get machine data from D1 (with request-scope caching)
 * @param {string} machineId
 * @param {Object} env
 * @returns {Promise<Object|null>}
 */
export async function getMachineData(machineId, env) {
  const cached = requestCache.get(machineId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const row = await env.DB.prepare("SELECT data FROM machines WHERE machineId = ?")
    .bind(machineId)
    .first();
  
  if (!row) {
    log.debug("STORAGE", `Not found: ${machineId}`);
    return null;
  }
  
  const data = JSON.parse(row.data);
  requestCache.set(machineId, { data, timestamp: Date.now() });
  log.debug("STORAGE", `Retrieved: ${machineId}`);
  return data;
}

/**
 * Save machine data to D1
 * @param {string} machineId
 * @param {Object} data
 * @param {Object} env
 */
export async function saveMachineData(machineId, data, env) {
  const now = new Date().toISOString();
  data.updatedAt = now;
  
  // Upsert to D1
  await env.DB.prepare(`
    INSERT INTO machines (machineId, data, updatedAt) 
    VALUES (?, ?, ?)
    ON CONFLICT(machineId) DO UPDATE SET data = ?, updatedAt = ?
  `)
    .bind(machineId, JSON.stringify(data), now, JSON.stringify(data), now)
    .run();
  
  // Update cache after save
  requestCache.set(machineId, { data, timestamp: Date.now() });
  log.debug("STORAGE", `Saved: ${machineId}`);
}

/**
 * Delete machine data from D1
 * @param {string} machineId
 * @param {Object} env
 */
export async function deleteMachineData(machineId, env) {
  await env.DB.prepare("DELETE FROM machines WHERE machineId = ?")
    .bind(machineId)
    .run();
  
  // Clear cache after delete
  requestCache.delete(machineId);
  log.debug("STORAGE", `Deleted: ${machineId}`);
}

/**
 * Update specific fields in machine data (for token refresh, rate limit, etc.)
 * @param {string} machineId
 * @param {string} connectionId
 * @param {Object} updates
 * @param {Object} env
 */
export async function updateMachineProvider(machineId, connectionId, updates, env) {
  const data = await getMachineData(machineId, env);
  if (!data?.providers?.[connectionId]) return;
  
  Object.assign(data.providers[connectionId], updates);
  data.providers[connectionId].updatedAt = new Date().toISOString();
  
  await saveMachineData(machineId, data, env);
}