import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { sharedAdapterAsync } from "./sharedAdapter.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

async function createSqlJsAdapterRaw(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

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

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
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

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (saveTimer) clearTimeout(saveTimer);
    process.removeListener("beforeExit", onBeforeExit);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    if (dirty) persist();
    db.close();
  }

  const flush = () => { if (dirty) try { persist(); } catch {} };
  const onBeforeExit = () => { flush(); close(); };
  const onSigint = () => { flush(); close(); };
  const onSigterm = () => { flush(); close(); };
  process.on("beforeExit", onBeforeExit);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}

export async function createSqlJsAdapter(filePath) {
  return sharedAdapterAsync(filePath, createSqlJsAdapterRaw);
}
