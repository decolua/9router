// Postgres adapter — async mirror of betterSqliteAdapter's shape.
//
// Interface (all async now):
//   run(sql, params)   → { changes, lastInsertRowid }
//   get(sql, params)    → row | undefined
//   all(sql, params)    → row[]
//   exec(sql)           → void   (DDL / multi-statement, no params)
//   transaction(fn)     → await fn()   (BEGIN/COMMIT around a dedicated client)
//   checkpoint()        → no-op (SQLite WAL concept)
//   close()             → no-op (pool lifecycle is global, see pg.js)
//
// transaction() pins a single pooled client for the duration of `fn` via
// AsyncLocalStorage, so nested `db.get/run/all` calls inside the callback run
// on the same connection and inside the same BEGIN block.
import { AsyncLocalStorage } from "node:async_hooks";
import { getPool, toPgPlaceholders, ciRow } from "../pg.js";

const txStore = new AsyncLocalStorage();

export async function createPostgresAdapter() {
  const pool = getPool();

  // Fail fast with a clear message if Postgres is unreachable / DB missing.
  const probe = await pool.connect();
  probe.release();

  const executor = () => txStore.getStore()?.client || pool;

  async function query(sql, params = []) {
    return executor().query(toPgPlaceholders(sql), params);
  }

  const wantsReturning = (sql) => /\breturning\b/i.test(sql);

  return {
    driver: "postgres",

    async run(sql, params = []) {
      const res = await query(sql, params);
      return {
        changes: res.rowCount ?? 0,
        lastInsertRowid: wantsReturning(sql) ? (res.rows?.[0]?.id ?? null) : null,
      };
    },

    async get(sql, params = []) {
      const res = await query(sql, params);
      return res.rows.length ? ciRow(res.rows[0]) : undefined;
    },

    async all(sql, params = []) {
      const res = await query(sql, params);
      return res.rows.map(ciRow);
    },

    // DDL and multi-statement scripts. Simple-query protocol (no params) allows
    // several `;`-separated statements in one call.
    async exec(sql) {
      await executor().query(sql);
    },

    async transaction(fn) {
      // Re-entrant: an inner transaction() just joins the outer one.
      if (txStore.getStore()) return fn();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await txStore.run({ client }, () => fn());
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already broken */
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async checkpoint() {
      /* no-op: Postgres has no WAL checkpoint to trigger from the app */
    },

    async close() {
      /* no-op: pool is shared process-wide; see closePool() in pg.js */
    },

    raw: pool,
  };
}
