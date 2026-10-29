import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function sql(file) { return (await import("@/lib/db/adapters/sqljsAdapter.js")).createSqlJsAdapter(file); }

async function better(file) { return (await import("@/lib/db/adapters/betterSqliteAdapter.js")).createBetterSqliteAdapter(file); }

describe("proxy fitness adapters", () => {
  it("cleans owned listeners and preserves unrelated listeners for both adapters", async () => {
    for (const create of [sql, better]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-listeners-")); dirs.push(dir);
      const sentinel = () => {}; process.on("beforeExit", sentinel);
      const before = ["beforeExit", "SIGINT", "SIGTERM"].map((event) => [event, process.listenerCount(event)]);
      const first = await create(path.join(dir, "data.sqlite")); const second = await create(path.join(dir, ".", "data.sqlite"));
      first.close(); first.close(); second.close(); second.close();
      expect(process.listeners("beforeExit")).toContain(sentinel);
      for (const [event, count] of before) expect(process.listenerCount(event)).toBe(count);
      process.removeListener("beforeExit", sentinel);
    }
  });
  it("shares canonical sql.js facades and flushes a dirty final close", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-adapter-")); dirs.push(dir);
    const file = path.join(dir, "data.sqlite");
    const one = await sql(file); const two = await sql(path.join(dir, ".", "data.sqlite"));
    one.exec("CREATE TABLE example (value TEXT)"); one.run("INSERT INTO example(value) VALUES(?)", ["persisted"]);
    one.close(); two.close();
    const reopened = await sql(file); expect(reopened.get("SELECT value FROM example").value).toBe("persisted"); reopened.close();
  });
  it("rejects promise, arbitrary thenable, and getter thenable transaction continuations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-transaction-")); dirs.push(dir);
    const adapter = await sql(path.join(dir, "data.sqlite"));
    expect(() => adapter.transaction(() => Promise.resolve())).toThrow("synchronous");
    expect(() => adapter.transaction(() => ({ then() {} }))).toThrow("synchronous");
    expect(() => adapter.transaction(() => ({ get then() { throw new Error("hostile thenable"); } }))).toThrow("hostile thenable");
    adapter.close();
  });
  it("rejects asynchronous transactions through better-sqlite3", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-better-transaction-")); dirs.push(dir);
    const adapter = await better(path.join(dir, "data.sqlite"));
    expect(() => adapter.transaction(() => Promise.resolve())).toThrow("synchronous");
    adapter.close();
  });
  it("shares canonical better-sqlite3 facades", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-better-shared-")); dirs.push(dir);
    const first = await better(path.join(dir, "data.sqlite")); const second = await better(path.join(dir, ".", "data.sqlite"));
    first.exec("CREATE TABLE sample (value TEXT)"); first.run("INSERT INTO sample VALUES(?)", ["shared"]); first.close();
    expect(second.get("SELECT value FROM sample").value).toBe("shared"); second.close();
  });
  it("rejects nested transaction callbacks", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-nested-")); dirs.push(dir);
    const adapter = await sql(path.join(dir, "data.sqlite"));
    expect(() => adapter.transaction(() => adapter.transaction(() => 1))).toThrow("Nested");
    adapter.close();
  });
  it("migrates v3 sql.js data through close and reopen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitness-v3-")); dirs.push(dir);
    const file = path.join(dir, "data.sqlite"); const adapter = await sql(file);
    adapter.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    adapter.exec("CREATE TABLE proxyPoolFitness (poolId TEXT NOT NULL, scope TEXT NOT NULL, until INTEGER NOT NULL, reason TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY(poolId, scope))");
    adapter.run("INSERT INTO _meta VALUES(?, ?)", ["schemaVersion", "3"]);
    adapter.run("INSERT INTO proxyPoolFitness VALUES(?, ?, ?, ?, ?, ?)", ["pool", "freebuff::model", 100, "legacy", "created", "updated"]);
    const { runMigrationOnce } = await import("@/lib/db/migrate.js"); await runMigrationOnce(adapter); adapter.close();
    const reopened = await sql(file); expect(reopened.get("SELECT * FROM proxyPoolFitness")).toMatchObject({ version: 1, reason: "legacy", until: 100 }); reopened.close();
  });
});
