// PostgreSQL adapter — selected when DATABASE_URL is set.
// API matches SQLite adapters (async methods returning Promises).

import { toPgParams } from "../dialect.js";

export async function createPostgresAdapter(connectionString) {
  let pg;
  try {
    pg = await import("pg");
  } catch (e) {
    throw new Error(`[DB] pg package is not installed. Add it with: npm install pg — ${e.message}`);
  }

  const pool = new pg.default.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  // Verify connectivity early.
  await pool.query("SELECT 1");

  const adapter = {
    driver: "postgres",
    dialect: "postgres",

    async run(sql, params = []) {
      const { sql: q, params: p } = toPgParams(sql, params);
      const res = await pool.query(q, p);
      return { changes: res.rowCount ?? 0 };
    },

    async get(sql, params = []) {
      const { sql: q, params: p } = toPgParams(sql, params);
      const res = await pool.query(q, p);
      return res.rows[0] ?? undefined;
    },

    async all(sql, params = []) {
      const { sql: q, params: p } = toPgParams(sql, params);
      const res = await pool.query(q, p);
      return res.rows;
    },

    async exec(sql) {
      const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        const { sql: q } = toPgParams(stmt);
        await pool.query(q);
      }
    },

    async transaction(fn) {
      const client = await pool.connect();
      const tx = {
        dialect: "postgres",
        async run(sql, params = []) {
          const { sql: q, params: p } = toPgParams(sql, params);
          const res = await client.query(q, p);
          return { changes: res.rowCount ?? 0 };
        },
        async get(sql, params = []) {
          const { sql: q, params: p } = toPgParams(sql, params);
          const res = await client.query(q, p);
          return res.rows[0] ?? undefined;
        },
        async all(sql, params = []) {
          const { sql: q, params: p } = toPgParams(sql, params);
          const res = await client.query(q, p);
          return res.rows;
        },
        async exec(sql) {
          const { sql: q } = toPgParams(sql);
          await client.query(q);
        },
      };
      try {
        await client.query("BEGIN");
        await fn(tx);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },

    checkpoint() { /* no-op for postgres */ },

    async close() {
      await pool.end();
    },

    raw: pool,
  };

  return adapter;
}
