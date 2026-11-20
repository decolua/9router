// Cloudflare D1 adapter — persistent storage for Cloudflare Workers.
//
// D1's API is async, but the adapter interface is synchronous.
// Strategy: "memory + D1 write-through"
//   1. Cold start: bulk-load all tables from D1 into memory
//   2. Reads hit memory (fast, sync)
//   3. Writes go to memory (sync) AND queue async D1 writes
//   4. Queued D1 writes flush via microtask batching + ctx.waitUntil

import { TABLES, buildCreateTableSql } from "../schema.js";

const MAX_BATCH = 50;

function getExecutionContext() {
  try {
    const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
    return cfCtx?.ctx || null;
  } catch {
    return null;
  }
}

function createWriteQueue(d1) {
  const queue = [];
  let flushScheduled = false;

  async function flush() {
    flushScheduled = false;
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        const stmts = batch.map(({ sql, params }) =>
          params && params.length > 0
            ? d1.prepare(sql).bind(...params)
            : d1.prepare(sql)
        );
        await d1.batch(stmts);
      } catch (e) {
        console.error("[D1] batch write failed:", e.message);
        for (const s of batch) console.error("[D1]  ↳", s.sql.slice(0, 120));
      }
    }
  }

  function schedule() {
    if (flushScheduled) return;
    flushScheduled = true;
    const p = flush();
    const ctx = getExecutionContext();
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(p);
    }
  }

  return {
    push(sql, params) { queue.push({ sql, params }); schedule(); },
    async flushNow() { while (queue.length > 0) { flushScheduled = false; await flush(); } },
    get pending() { return queue.length; },
  };
}

async function hydrateFromD1(d1, memAdapter) {
  const tableNames = Object.keys(TABLES);
  const results = await Promise.allSettled(
    tableNames.map(async (name) => {
      try {
        const { results } = await d1.prepare(`SELECT * FROM ${name}`).all();
        return { name, rows: results || [] };
      } catch { return { name, rows: [] }; }
    })
  );

  let totalRows = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { name, rows } = r.value;
    if (rows.length === 0) continue;
    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(", ");
      const sql = `INSERT OR REPLACE INTO ${name}(${cols.join(", ")}) VALUES(${placeholders})`;
      try { memAdapter.run(sql, cols.map((c) => row[c])); }
      catch (e) { console.warn(`[D1] hydrate skip ${name}: ${e.message}`); }
    }
    totalRows += rows.length;
  }
  return totalRows;
}

async function ensureD1Schema(d1) {
  const stmts = [];
  for (const [name, def] of Object.entries(TABLES)) {
    stmts.push(d1.prepare(buildCreateTableSql(name, def)));
    if (def.indexes) {
      for (const idx of def.indexes) stmts.push(d1.prepare(idx));
    }
  }
  for (let i = 0; i < stmts.length; i += MAX_BATCH) {
    await d1.batch(stmts.slice(i, i + MAX_BATCH));
  }
}

const MUTATING_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;
function isMutating(sql) { return MUTATING_RE.test(sql); }

export async function createD1Adapter(d1) {
  await ensureD1Schema(d1);

  const { createMemoryAdapter } = await import("./memoryAdapter.js");
  const mem = createMemoryAdapter();

  const totalRows = await hydrateFromD1(d1, mem);
  console.log(`[DB] D1 adapter: hydrated ${totalRows} rows from D1 into memory`);

  const wq = createWriteQueue(d1);

  return {
    driver: "d1",

    run(sql, params = []) {
      const result = mem.run(sql, params);
      if (isMutating(sql)) wq.push(sql, params);
      return result;
    },

    get(sql, params = []) { return mem.get(sql, params); },
    all(sql, params = []) { return mem.all(sql, params); },

    exec(sql) {
      mem.exec(sql);
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (isMutating(stmt)) wq.push(stmt, []);
      }
    },

    transaction(fn) { return mem.transaction(fn); },
    close() {},
    async flushD1() { await wq.flushNow(); },
    get pendingWrites() { return wq.pending; },

    async syncTable(tableName, limit = 200) {
      try {
        let orderClause = "";
        if (tableName === "usageHistory") orderClause = "ORDER BY id DESC";
        else if (tableName === "requestDetails") orderClause = "ORDER BY timestamp DESC";
        const query = limit > 0 && orderClause
          ? `SELECT * FROM ${tableName} ${orderClause} LIMIT ${limit}`
          : `SELECT * FROM ${tableName}`;
        const { results } = await d1.prepare(query).all();
        if (results && results.length > 0) {
          for (const row of results) {
            const cols = Object.keys(row);
            const placeholders = cols.map(() => "?").join(", ");
            const sql = `INSERT OR REPLACE INTO ${tableName}(${cols.join(", ")}) VALUES(${placeholders})`;
            try { mem.run(sql, cols.map((c) => row[c])); } catch {}
          }
        }
      } catch (e) {
        console.warn(`[D1] syncTable ${tableName} failed: ${e.message}`);
      }
    },
  };
}
