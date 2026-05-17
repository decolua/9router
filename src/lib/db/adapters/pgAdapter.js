import { AsyncLocalStorage } from "node:async_hooks";
import { TABLES } from "../schema.js";

// Per-async-context transaction client — allows nested repo calls inside a transaction
// to use the same pg client without changing repo function signatures.
const txStorage = new AsyncLocalStorage();

// Camelcase column names that PG would fold to lowercase without quoting.
const CAMEL_IDENTIFIERS = new Set(
  Object.values(TABLES).flatMap((def) => Object.keys(def.columns).filter((k) => k !== k.toLowerCase()))
);

// Wraps camelCase identifiers in double quotes so PG preserves case.
// Skips both double-quoted identifiers and single-quoted string literals.
function quoteIdentifiers(sql) {
  const TOKEN_RE = /"[^"]*"|'[^']*'/g;
  const tokens = [];
  const parts = [];
  let lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(sql)) !== null) {
    parts.push(sql.slice(lastIndex, m.index));
    tokens.push(m[0]);
    lastIndex = m.index + m[0].length;
  }
  parts.push(sql.slice(lastIndex));
  const processed = parts.map((part) => {
    let s = part;
    for (const name of CAMEL_IDENTIFIERS) {
      s = s.replace(new RegExp(`\\b${name}\\b`, "g"), `"${name}"`);
    }
    return s;
  });
  return processed.reduce((acc, p, i) => acc + p + (tokens[i] || ""), "");
}

// Table → primary key columns (for INSERT OR REPLACE → upsert translation)
const TABLE_PK = {
  _meta: ["key"],
  settings: ["id"],
  providerConnections: ["id"],
  providerNodes: ["id"],
  proxyPools: ["id"],
  apiKeys: ["id"],
  combos: ["id"],
  kv: ["scope", "key"],
  usageDaily: ["dateKey"],
  requestDetails: ["id"],
};

function translateSql(sql, params) {
  if (!sql) return { sql: null, params };
  const trimmed = sql.trim();

  // Skip PRAGMA statements
  if (/^PRAGMA\b/i.test(trimmed)) return { sql: null, params };

  let result = sql;

  // INSERT OR REPLACE INTO → ON CONFLICT upsert
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(result)) {
    const match = result.match(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i
    );
    if (match) {
      const table = match[1];
      const cols = match[2].split(",").map((s) => s.trim());
      const valsPart = match[3];
      const pk = TABLE_PK[table];
      const updateCols = pk ? cols.filter((c) => !pk.includes(c)) : [];
      let upsert = `INSERT INTO ${table}(${cols.join(", ")}) VALUES(${valsPart})`;
      if (pk && updateCols.length > 0) {
        upsert += ` ON CONFLICT(${pk.join(", ")}) DO UPDATE SET ${updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(", ")}`;
      } else if (pk) {
        upsert += ` ON CONFLICT(${pk.join(", ")}) DO NOTHING`;
      }
      result = upsert;
    }
  }

  // Translate CREATE TABLE: AUTOINCREMENT → SERIAL handled via schema builder,
  // but handle any leftover AUTOINCREMENT in raw SQL
  result = result.replace(/\bAUTOINCREMENT\b/gi, "");

  // Convert ? positional placeholders to $N
  let i = 0;
  result = result.replace(/\?/g, () => `$${++i}`);

  // Quote camelCase identifiers to preserve case
  result = quoteIdentifiers(result);

  return { sql: result, params };
}

function translateExecSql(sql) {
  // Multi-statement exec (schema creation). Process each statement.
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^PRAGMA\b/i.test(s))
    .map((s) =>
      quoteIdentifiers(
        s
          .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY")
          .replace(/\bAUTOINCREMENT\b/gi, "")
      )
    );
}

async function queryWith(client, sql, params = []) {
  return client.query(sql, params.length ? params : undefined);
}

export async function createPgAdapter(connectionString) {
  let Pool;
  try {
    const pg = await import("pg");
    Pool = pg.default?.Pool ?? pg.Pool;
  } catch {
    throw new Error("[DB] pg package not installed. Run: npm install pg");
  }

  const pool = new Pool({ connectionString, max: 10 });

  // Verify connectivity
  const testClient = await pool.connect();
  testClient.release();

  async function getClient() {
    return txStorage.getStore() ?? pool;
  }

  async function run(sql, params = []) {
    const { sql: t, params: p } = translateSql(sql, params);
    if (!t) return { changes: 0, lastInsertRowid: null };
    const client = await getClient();
    const result = await queryWith(client, t, p);
    return { changes: result.rowCount ?? 0, lastInsertRowid: null };
  }

  async function get(sql, params = []) {
    // PRAGMA table_info → information_schema (lowercase table name: PG folds unquoted table names)
    const ti = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)\s*$/i);
    if (ti) {
      const client = await getClient();
      const r = await queryWith(client, `SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [ti[1].toLowerCase()]);
      return r.rows[0];
    }
    const { sql: t, params: p } = translateSql(sql, params);
    if (!t) return undefined;
    const client = await getClient();
    const result = await queryWith(client, t, p);
    return result.rows[0] ?? undefined;
  }

  async function all(sql, params = []) {
    // PRAGMA table_info → information_schema (lowercase table name: PG folds unquoted table names)
    const ti = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)\s*$/i);
    if (ti) {
      const client = await getClient();
      const r = await queryWith(client, `SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [ti[1].toLowerCase()]);
      return r.rows;
    }
    const { sql: t, params: p } = translateSql(sql, params);
    if (!t) return [];
    const client = await getClient();
    const result = await queryWith(client, t, p);
    return result.rows;
  }

  async function exec(sql) {
    const stmts = translateExecSql(sql);
    const client = await getClient();
    for (const stmt of stmts) await queryWith(client, stmt);
  }

  async function transaction(fn) {
    const existingClient = txStorage.getStore();
    if (existingClient) {
      // Already inside a transaction — run fn directly (nested, no new BEGIN)
      return fn();
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await txStorage.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async function close() {
    await pool.end();
  }

  console.log(`[DB] Driver: postgresql | url: ${connectionString.replace(/:[^:@]+@/, ":***@")}`);

  return { driver: "postgresql", dialect: "postgresql", run, get, all, exec, transaction, close };
}
