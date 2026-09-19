import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    const data = Buffer.from(db.export());
    // Atomic replace: write a sibling temp file, then rename over the live db.
    // writeFileSync straight onto filePath truncates it first — a crash between
    // truncation and the last byte leaves a corrupt database, and unlike the
    // native adapters there is no WAL to recover from: this IS the durability
    // layer. rename() is atomic against a crash; worst case the old file stays.
    // (No fsync on purpose — same durability trade-off the native adapters make
    // with `PRAGMA synchronous = NORMAL`, without stalling hot debounced saves.)
    const tmpPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(tmpPath, data);
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw e;
    }
    dirty = false;
  }

  // Persistence self-check at boot (T1.4 M-1): sql.js runs fully in memory and
  // mirrors the db to filePath on every save. If that mirror cannot be written,
  // staying alive means silently losing EVERYTHING since boot the moment the
  // process ends — so write+read round-trip the real image now and fail loudly
  // instead. The driver fallback chain treats a throw here as "sql.js
  // unavailable", which surfaces as an explicit "[DB] No SQLite driver
  // available" error rather than a quiet in-memory-only run.
  try {
    persist();
    const back = fs.readFileSync(filePath);
    if (back.length < 16 || back.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
      throw new Error(`read-back mismatch after boot persist (${back.length} bytes, bad SQLite header)`);
    }
  } catch (e) {
    throw new Error(`[sqljs] refusing in-memory-only boot: database file '${filePath}' is not writable/verifiable (${e?.message || e})`);
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

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    try {
      if (dirty) persist();
    } finally {
      // Drop the shutdown hooks with the adapter they belong to: closeAdapter()
      // can be followed by a fresh getAdapter(), and a listener per adapter
      // instance leaks (sibling-adapter policy).
      process.off("beforeExit", flush);
      process.off("exit", flush);
    }
    db.close();
  }

  // Flush on orderly shutdown. SIGINT/SIGTERM are deliberately NOT registered
  // here (T1.4 M-2): a listener for a signal suppresses Node's default kill,
  // and this flush does not call process.exit() — Ctrl+C/SIGTERM would then
  // hang forever, and the handlers would race the shutdown coordinator
  // (src/shared/services/initializeApp.js) that owns signals and calls
  // closeAdapter(). Same documented policy as bun/better/node adapters. "exit"
  // stays in addition to "beforeExit" because sql.js has no WAL: a script that
  // ends via process.exit() would otherwise lose the debounced save, and the
  // persist below is fully synchronous, so it actually completes during exit.
  function flush() {
    if (dirty) {
      try { persist(); } catch (e) { console.error("[sqljs] shutdown save failed:", e?.message || e); }
    }
  }
  process.on("beforeExit", flush);
  process.on("exit", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
