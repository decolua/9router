// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. API mirrors betterSqliteAdapter.
import type { DbAdapter } from "../driver.js";
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createNodeSqliteAdapter(filePath: string): Promise<DbAdapter> {
  // Suppress "ExperimentalWarning: SQLite is an experimental feature" from node:sqlite.
  const origEmit = process.emit;
  process.emit = function (name: string, data: unknown, ...rest: unknown[]) {
    if (
      name === "warning" &&
      data && typeof data === "object" && "name" in data && (data as { name: unknown }).name === "ExperimentalWarning" &&
      "message" in data && /SQLite/i.test(String((data as { message: unknown }).message ?? ""))
    ) {
      return false;
    }
    return (origEmit as typeof process.emit).call(process, name as Parameters<typeof process.emit>[0], data, ...rest);
  } as typeof process.emit;

  // Dynamic import: node:sqlite is experimental and only available in Node >= 22.5.
  const sqlite = await import("node:sqlite");
  const Database = (sqlite as { DatabaseSync: new (path: string) => NodeSqliteDb }).DatabaseSync;
  const db = new Database(filePath);

  db.exec(PRAGMA_SQL);

  const stmtCache = new Map<string, NodeSqliteStmt>();
  function prepare(sql: string) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const checkpointTimer = setInterval(() => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "node:sqlite",
    run(sql, params = []) {
      const r = prepare(sql).run(...(params as unknown[])) as { changes?: number; lastInsertRowid?: number };
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...(params as unknown[])) as Record<string, unknown> | undefined;
    },
    all(sql, params = []) {
      return prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    exec(sql) { db.exec(sql); },
    transaction(fn) {
      // node:sqlite has no transaction wrapper. Use SAVEPOINT for nested support.
      const sp = `sp_${Math.random().toString(36).slice(2)}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const r = fn();
        db.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
        throw e;
      }
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() { clearInterval(checkpointTimer); gracefulClose(); },
    raw: db,
  };
}

// Minimal local interfaces for the node:sqlite DatabaseSync API.
// These are not exported — they only exist to avoid `unknown` in the adapter body.
interface NodeSqliteStmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}
interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStmt;
  close(): void;
}
