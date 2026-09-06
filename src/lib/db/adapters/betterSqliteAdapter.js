import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";
import { sharedAdapter } from "./sharedAdapter.js";

// Periodic checkpoint to keep WAL file small (avoid huge -wal/-shm growth)
const CHECKPOINT_INTERVAL_MS = 60 * 1000;

function createBetterSqliteAdapterRaw(filePath) {
  const db = new Database(filePath);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  const stmtCache = new Map();

  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Truncate WAL periodically so file stays small for backup/copy
  const checkpointTimer = setInterval(() => {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  let closed = false;
  function gracefulClose() {
    if (closed) return;
    closed = true;
    clearInterval(checkpointTimer);
    process.removeListener("beforeExit", onBeforeExit);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  const onBeforeExit = () => gracefulClose();
  const onSigint = () => { gracefulClose(); process.exit(0); };
  const onSigterm = () => { gracefulClose(); process.exit(0); };
  process.once("beforeExit", onBeforeExit);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { return db.exec(sql); },
    transaction(fn) { return db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
    close() { gracefulClose(); },
    raw: db,
  };
}

export function createBetterSqliteAdapter(filePath) {
  return sharedAdapter(filePath, createBetterSqliteAdapterRaw);
}
