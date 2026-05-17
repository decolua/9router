import { AsyncLocalStorage } from "node:async_hooks";

const txStorage = new AsyncLocalStorage();

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

// Backtick-quote MySQL reserved words used as column names in this schema.
function quoteReserved(sql) {
  return sql.replace(/(?<!`)\bkey\b(?!`)/g, "`key`");
}

function translateSql(sql) {
  if (!sql) return null;
  const trimmed = sql.trim();

  if (/^PRAGMA\b/i.test(trimmed)) return null;

  let result = sql;

  // INSERT OR REPLACE INTO → INSERT ... ON DUPLICATE KEY UPDATE (true upsert semantics)
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(result)) {
    const match = result.match(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i
    );
    if (match) {
      const table = match[1];
      const cols = match[2].split(",").map((s) => s.trim());
      const valsPart = match[3];
      const pk = TABLE_PK[table];
      const updateCols = pk ? cols.filter((c) => !pk.includes(c)) : cols;
      let upsert = `INSERT INTO ${table}(${cols.join(", ")}) VALUES(${valsPart})`;
      if (updateCols.length > 0) {
        upsert += ` ON DUPLICATE KEY UPDATE ${updateCols.map((c) => `${c}=VALUES(${c})`).join(", ")}`;
      }
      result = upsert;
    }
  }

  // ON CONFLICT(...) DO UPDATE SET col=excluded.col → ON DUPLICATE KEY UPDATE col=VALUES(col)
  result = result.replace(
    /\s+ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+?)(?=\s*(?:$|;))/gi,
    (_, setClause) => {
      const transformed = setClause.replace(/(\w+)\s*=\s*excluded\.(\w+)/gi, "$1=VALUES($2)");
      return ` ON DUPLICATE KEY UPDATE ${transformed}`;
    }
  );

  return quoteReserved(result);
}

function translateExecSql(sql) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^PRAGMA\b/i.test(s))
    .map((s) =>
      s
        .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "INT PRIMARY KEY AUTO_INCREMENT")
        .replace(/INTEGER\s+PRIMARY\s+KEY/gi, "INT PRIMARY KEY")
        .replace(/\bAUTOINCREMENT\b/gi, "AUTO_INCREMENT")
        .replace(/\bREAL\b/gi, "DOUBLE")
        .replace(/\bINTEGER\b/gi, "INT")
        .replace(/\bTEXT\s+PRIMARY\s+KEY\b/gi, "VARCHAR(255) PRIMARY KEY")
        .replace(/\bTEXT\s+UNIQUE\s+NOT\s+NULL\b/gi, "VARCHAR(255) UNIQUE NOT NULL")
        .replace(/\bTEXT\s+UNIQUE\b/gi, "VARCHAR(255) UNIQUE")
        // scope/key columns (composite PK members) → VARCHAR(191); data columns → MEDIUMTEXT
        .replace(/\b(scope|key)\s+TEXT\s+NOT\s+NULL\b/gi, "$1 VARCHAR(191) NOT NULL")
        .replace(/\bTEXT\s+NOT\s+NULL\b/gi, "MEDIUMTEXT NOT NULL")
        .replace(/\bTEXT\b/gi, "MEDIUMTEXT")
    ).map(quoteReserved);
}

async function getConn() {
  return txStorage.getStore() ?? null;
}

export async function createMysqlAdapter(connectionString) {
  let mysql;
  try {
    mysql = await import("mysql2/promise");
  } catch {
    throw new Error("[DB] mysql2 package not installed. Run: npm install mysql2");
  }

  const pool = mysql.createPool(connectionString);

  // Verify connectivity
  const conn = await pool.getConnection();
  conn.release();

  async function query(sql, params = []) {
    const txConn = await getConn();
    const client = txConn ?? pool;
    const [rows, fields] = await client.execute(sql, params.length ? params : undefined);
    return { rows: Array.isArray(rows) ? rows : [], rowCount: rows?.affectedRows ?? 0, insertId: rows?.insertId ?? null };
  }

  async function run(sql, params = []) {
    const t = translateSql(sql);
    if (!t) return { changes: 0, lastInsertRowid: null };
    const result = await query(t, params);
    return { changes: result.rowCount, lastInsertRowid: result.insertId };
  }

  async function get(sql, params = []) {
    const ti = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)\s*$/i);
    if (ti) {
      const r = await query(`SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?`, [ti[1]]);
      return r.rows[0];
    }
    const t = translateSql(sql);
    if (!t) return undefined;
    const result = await query(t, params);
    return result.rows[0] ?? undefined;
  }

  async function all(sql, params = []) {
    const ti = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)\s*$/i);
    if (ti) {
      const r = await query(`SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?`, [ti[1]]);
      return r.rows;
    }
    const t = translateSql(sql);
    if (!t) return [];
    const result = await query(t, params);
    return result.rows;
  }

  async function exec(sql) {
    const stmts = translateExecSql(sql);
    const txConn = await getConn();
    const client = txConn ?? pool;
    for (const stmt of stmts) await client.execute(stmt);
  }

  async function transaction(fn) {
    const existingConn = await getConn();
    if (existingConn) return fn();
    const txConn = await pool.getConnection();
    try {
      await txConn.beginTransaction();
      const result = await txStorage.run(txConn, fn);
      await txConn.commit();
      return result;
    } catch (e) {
      try { await txConn.rollback(); } catch {}
      throw e;
    } finally {
      txConn.release();
    }
  }

  async function close() {
    await pool.end();
  }

  console.log(`[DB] Driver: mysql | url: ${connectionString.replace(/:[^:@]+@/, ":***@")}`);

  return { driver: "mysql", dialect: "mysql", run, get, all, exec, transaction, close };
}
