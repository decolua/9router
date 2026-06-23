import fs from "node:fs";
import initSqlJs from "sql.js";
import type { DbAdapter } from "../driver.js";
import { PRAGMA_SQL } from "../schema.js";

// sql.js ships its own types; Database/Statement shapes come from @types/sql.js.
type SqlJsDb = Awaited<ReturnType<typeof initSqlJs>>["Database"] extends new (...a: unknown[]) => infer T ? T : never;

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

const SAVE_DEBOUNCE_MS = 100;

export async function createSqlJsAdapter(filePath: string): Promise<DbAdapter> {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf ?? undefined);
  db.exec(PRAGMA_SQL);

  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function persist() {
    const data = db.export();
    fs.writeFileSync(filePath, Buffer.from(data));
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params: unknown[]) {
    if (!params || params.length === 0) return undefined;
    return params;
  }

  function run(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const rows = db.exec("SELECT last_insert_rowid() as id");
      const lastInsertRowid = rows[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid: lastInsertRowid as number };
    } finally {
      stmt.free();
    }
  }

  function get(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject() as Record<string, unknown>;
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql: string) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn: () => void) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close() {
    clearTimeout(saveTimer ?? undefined);
    if (dirty) persist();
    db.close();
  }

  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db as SqlJsDb };
}
