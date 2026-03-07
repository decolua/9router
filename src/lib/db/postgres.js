/**
 * PostgreSQL adapter skeleton for 9Router (Phase 5 – multi-user storage).
 * When DATABASE_URL is set, this module can be used to back localDb/usageDb
 * instead of JSON files. Current implementation: pool only; data access
 * still goes through localDb/usageDb (file-based) until full migration.
 *
 * Schema (see plan docs): users, provider_connections, provider_nodes,
 * model_aliases, combos, api_keys, settings, pricing, usage_history.
 *
 * Usage: const pool = await getPool(); if (pool) { ... use pool.query() }
 * Requires: npm install pg when using Postgres.
 */

let poolInstance = null;

/**
 * Get PostgreSQL pool. Returns null if DATABASE_URL is not set.
 * @returns {Promise<import('pg').Pool|null>}
 */
export async function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  if (poolInstance) return poolInstance;

  try {
    const { default: pg } = await import("pg");
    // Keep pool small per process: Next.js can spawn many workers, each with its own pool.
    // Default PostgreSQL max_connections is often 100; avoid exhausting it.
    const maxConnections = Math.min(parseInt(process.env.PG_POOL_MAX, 10) || 3, 20);
    poolInstance = new pg.Pool({
      connectionString: url,
      max: maxConnections,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 5000,
    });
    return poolInstance;
  } catch (err) {
    console.warn("[postgres] pg not available or DATABASE_URL invalid:", err?.message);
    return null;
  }
}

/**
 * Check if Postgres is configured (DATABASE_URL set).
 * @returns {boolean}
 */
export function isPostgresEnabled() {
  return !!process.env.DATABASE_URL;
}
