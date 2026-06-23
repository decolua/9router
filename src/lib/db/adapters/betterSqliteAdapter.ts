import Database from "better-sqlite3";
import type { DbAdapter } from "../driver.js";
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath: string): DbAdapter {
  const db = new Database(filePath);
  db.exec(PRAGMA_SQL);

  const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();

  function prepare(sql: string) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const checkpointTimer = setInterval(() => {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return prepare(sql).run(params as unknown[]); },
    get(sql, params = []) { return prepare(sql).get(params as unknown[]) as Record<string, unknown> | undefined; },
    all(sql, params = []) { return prepare(sql).all(params as unknown[]) as Record<string, unknown>[]; },
    exec(sql) { db.exec(sql); },
    transaction(fn) { db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
    close() { clearInterval(checkpointTimer); gracefulClose(); },
    raw: db,
  };
}
