import { getApiKeyByKey } from "@/lib/localDb";

/**
 * In-memory cache for API key records.
 * Avoids repeated disk reads (LowDB reads JSON from disk on every getDb() call).
 *
 * NOTE: This cache is a process-level singleton. It works correctly in Next.js
 * standalone mode (single process). If the app ever uses multiple workers or
 * edge runtimes, this cache would need to be replaced with a shared store.
 *
 * Cache entry: { record, expiresAt }
 * - TTL: 10 minutes for valid keys, 60 seconds for invalid (null) lookups
 * - Invalidated explicitly on key update/delete via invalidate()
 * - Max size bounded to prevent memory exhaustion from random key probing
 */

const VALID_TTL_MS = 10 * 60 * 1000;   // 10 minutes for valid keys
const NULL_TTL_MS = 60 * 1000;          // 60 seconds for invalid keys
const MAX_CACHE_SIZE = 500;

/** @type {Map<string, { record: object|null, expiresAt: number }>} */
const cache = new Map();

/**
 * Clone an API key record to prevent mutation of cached data.
 */
function cloneRecord(record) {
  if (!record) return null;
  return {
    ...record,
    allowedModels: record.allowedModels ? [...record.allowedModels] : [],
    allowedConnections: record.allowedConnections ? [...record.allowedConnections] : [],
  };
}

/**
 * Evict expired entries. Called when cache reaches max size.
 */
function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/**
 * Get API key record with caching.
 * Returns a cloned key object or null.
 * @param {string} key - The API key string (sk-...)
 * @returns {Promise<object|null>}
 */
export async function getCachedApiKeyRecord(key) {
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && entry.expiresAt > now) {
    return cloneRecord(entry.record);
  }

  // Cache miss or expired — fetch from DB
  const record = await getApiKeyByKey(key);

  // Enforce max size before inserting
  if (cache.size >= MAX_CACHE_SIZE) {
    evictExpired();
    // If still at limit after eviction, clear everything
    if (cache.size >= MAX_CACHE_SIZE) {
      cache.clear();
    }
  }

  cache.set(key, {
    record: cloneRecord(record),
    expiresAt: now + (record ? VALID_TTL_MS : NULL_TTL_MS),
  });

  return cloneRecord(record);
}

/**
 * Invalidate cache for a specific key string.
 * Call this when a key is updated.
 * @param {string} key - The API key string (sk-...)
 */
export function invalidateApiKeyCache(key) {
  cache.delete(key);
}

/**
 * Invalidate cache for a key by its ID.
 * Since cache is keyed by key string, we scan entries.
 * @param {string} id - The API key UUID
 */
export function invalidateApiKeyCacheById(id) {
  for (const [key, entry] of cache.entries()) {
    if (entry.record?.id === id) {
      cache.delete(key);
      break;
    }
  }
}

/**
 * Clear entire cache. Call on bulk operations.
 */
export function clearApiKeyCache() {
  cache.clear();
}
