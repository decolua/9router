/**
 * Short-lived cache for `getMcpServers({ isActive: true })`.
 *
 * A single gateway JSON-RPC message routinely resolves the active-servers
 * list 3-5 times (tools/list → tools/call → status URI → …). Each call hits
 * the local SQL store — cheap, but not free, and the answer doesn't change
 * within a single request.
 *
 * A ~500 ms TTL is short enough that mutations feel instant to a human user
 * (dashboard toggle + client refresh both stay well under a second) and long
 * enough to collapse every read inside a single gateway fan-out into one DB
 * hit. Mutations still call `invalidateActiveServersCache()` explicitly so
 * changes are visible on the very next request.
 */

import { getMcpServers } from "@/models";

/** @typedef {import("./types.js").McpServer} McpServer */

const TTL_MS = 500;

/** @type {{ expires: number, promise: Promise<McpServer[]> | null }} */
let cache = { expires: 0, promise: null };

/**
 * Return the current active-server list, resolving from cache when fresh.
 * Concurrent callers share the in-flight promise so we never issue duplicate
 * DB reads under load.
 *
 * @returns {Promise<McpServer[]>}
 */
export async function getActiveServersCached() {
  const now = Date.now();
  if (cache.promise && cache.expires > now) {
    return cache.promise;
  }
  const promise = getMcpServers({ isActive: true });
  cache = { expires: now + TTL_MS, promise };
  try {
    return await promise;
  } catch (err) {
    // Don't pin a failed lookup — next caller retries immediately.
    cache = { expires: 0, promise: null };
    throw err;
  }
}

/** Drop the cache. Call whenever a server is created / updated / deleted. */
export function invalidateActiveServersCache() {
  cache = { expires: 0, promise: null };
}
