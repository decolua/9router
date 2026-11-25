import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";

describe.each([["native", createNodeSqliteAdapter], ["sql.js", createSqlJsAdapter]])("%s gateway key storage", (driver, open) => {
  let dir, file, kek, db, migrate, repo, secret;
  async function reopen() {
    db.close();
    db = await open(file);
    global._dbAdapter.instance = db;
  }
  const columns = () => db.all("PRAGMA table_info(apiKeys)").map(c => c.name);
  const rows = table => db.all("SELECT * FROM " + table);
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-key-test-"));
    vi.stubEnv("DATA_DIR", dir);
    vi.stubEnv("API_KEY_SECRET", "fixture-first");
    delete global._dbAdapter;
    vi.resetModules();
    ({ runMigrationOnce: migrate } = await import("@/lib/db/migrate.js"));
    repo = await import("@/lib/db/index.js");
    file = path.join(dir, "fixture.sqlite");
    kek = path.join(dir, "key-encryption-key");
    db = await open(file);
    global._dbAdapter.instance = db;
    secret = "sk-fixture-" + randomBytes(24).toString("hex");
  });
  afterEach(() => {
    db?.close(); delete global._dbAdapter;
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function v5() {
    for (const name of ["_meta", "apiKeys", "retiredKeyFingerprints", "budgetReservations", "usageHistory", "usageDaily"]) {
      const sql = buildCreateTableSql(name, TABLES[name]);
      db.exec(sql.replace("key_ciphertext TEXT NOT NULL", "key TEXT UNIQUE NOT NULL"));
    }
    db.exec("CREATE INDEX idx_ak_key ON apiKeys(key)");
    db.exec("CREATE UNIQUE INDEX idx_key_verifier ON apiKeys(key_verifier)");
    db.exec("INSERT INTO _meta VALUES('schemaVersion','5'),('backupSchemaVersion','6')");
    db.run("INSERT INTO apiKeys(id,key,key_version,createdAt,rpmUsed,dailyRequests) VALUES('a',?,3,'now',12,31)", [secret]);
    db.run("INSERT INTO usageHistory(timestamp,apiKey) VALUES('now',?)", [secret]);
    db.run("INSERT INTO usageDaily VALUES('today',?)", [JSON.stringify({ byApiKey: {
      [secret + "|model|provider"]: { requests: 12, apiKey: secret },
    } })]);
    db.exec("INSERT INTO retiredKeyFingerprints VALUES('usage:old','a')");
    db.exec("INSERT INTO budgetReservations VALUES('req','a','now','pending','{}',12,17,NULL,NULL,NULL)");
  }

  it("preserves child rows, counters, verifier lookup and full GET; leaves a readable pre-schema backup", async () => {
    v5();
    const old = rows("apiKeys")[0], history = rows("retiredKeyFingerprints"), holds = rows("budgetReservations");
    await migrate(db);
    expect(columns()).not.toContain("key");
    expect(db.all("PRAGMA index_list(apiKeys)").map(i => i.name)).not.toContain("idx_ak_key");
    const { key, key_verifier, ...metadata } = old;
    expect(rows("apiKeys")[0].key_verifier).not.toBe(key_verifier);
    const ref = rows("usageHistory")[0].apiKey;
    expect(ref).toMatch(/^usage:[0-9a-f]{64}$/);
    expect(JSON.parse(rows("usageDaily")[0].data).byApiKey).toEqual({ [ref + "|model|provider"]: { requests: 12, apiKey: ref } });
    expect(rows("apiKeys")[0]).toMatchObject(metadata);
    expect(rows("retiredKeyFingerprints")).toEqual(history);
    expect(rows("budgetReservations")).toEqual(holds);
    expect(db.all("PRAGMA foreign_key_check")).toEqual([]);
    expect(db.get("PRAGMA foreign_keys").foreign_keys).toBe(1);
    expect(await repo.validateApiKey(key)).toBe(true);
    const { GET } = await import("@/app/api/keys/route.js");
    expect(await (await GET(new Request("http://localhost/api/keys"))).json()).toMatchObject({ keys: [{ key, keyVersion: 3 }] });
    const backups = path.join(dir, "db", "backups");
    const bak = new DatabaseSync(path.join(backups, fs.readdirSync(backups)[0], "data.sqlite"), { readOnly: true });
    try { expect(bak.prepare("SELECT * FROM apiKeys").get()).toEqual(old); } finally { bak.close(); }
    for (const f of [file, file + "-wal"]) if (fs.existsSync(f)) expect(fs.readFileSync(f).includes(key)).toBe(false);
    const snapshot = rows("apiKeys");
    await reopen(); await migrate(db);
    expect(rows("apiKeys")).toEqual(snapshot);
    expect(columns()).not.toContain("key");
    expect(fs.readdirSync(backups)).toHaveLength(1);
  });

  it("rolls back a fault after the copy and restores foreign_keys", async () => {
    v5();
    const old = rows("apiKeys");
    const run = db.exec;
    db.exec = sql => {
      if (sql === "DROP TABLE apiKeys") throw new Error("fixture after copy");
      return run.call(db, sql);
    };
    await expect(migrate(db)).rejects.toThrow("fixture after copy");
    expect(rows("apiKeys")).toEqual(old);
    expect(rows("retiredKeyFingerprints")).toHaveLength(1);
    expect(db.get("PRAGMA foreign_keys").foreign_keys).toBe(1);
    expect(db.get("SELECT value FROM _meta WHERE key='schemaVersion'").value).toBe("5");
    expect(db.get("SELECT 1 FROM sqlite_schema WHERE name='apiKeys_new'")).toBeFalsy();
    db.exec = run;
    await migrate(db);
    expect(await repo.validateApiKey(secret)).toBe(true);
  });

  it("requires a successful backup even when the backup version stamp is already current", async () => {
    v5();
    db.exec("UPDATE _meta SET value='8' WHERE key='backupSchemaVersion'");
    const spy = vi.spyOn(fs, "mkdtempSync").mockImplementationOnce(() => { throw new Error("injected backup error"); });
    try {
      await expect(migrate(db)).rejects.toMatchObject({
        code: "ERR_GATEWAY_DB_STARTUP", message: expect.stringContaining("Required pre-schema backup failed"),
      });
    }
    finally { spy.mockRestore(); }
    expect(columns()).toContain("key");
    expect(rows("apiKeys")[0].key).toBe(secret);
    expect(fs.existsSync(kek)).toBe(false);
  });

  it("resumes page cleanup after a committed rebuild without re-encrypting or enabling foreign_keys", async () => {
    v5();
    db.exec("PRAGMA foreign_keys=OFF");
    const exec = db.exec;
    db.exec = sql => {
      if (sql === "VACUUM") throw new Error("interrupted cleanup");
      return exec(sql);
    };
    await expect(migrate(db)).rejects.toThrow("interrupted cleanup");
    const snapshot = rows("apiKeys");
    expect(columns()).not.toContain("key");
    expect(db.get("PRAGMA foreign_keys").foreign_keys).toBe(0);
    expect(db.get("SELECT value FROM _meta WHERE key='gatewayKeyCleanupPending'").value).toBe("1");
    db.exec = exec;
    await reopen(); await migrate(db);
    expect(rows("apiKeys")).toEqual(snapshot);
    for (const f of [file, file + "-wal"]) if (fs.existsSync(f)) expect(fs.readFileSync(f).includes(secret)).toBe(false);
    expect(db.get("SELECT value FROM _meta WHERE key='gatewayKeyCleanupPending'")).toBeFalsy();
  });

  it.each(["missing", "short", "wrong"])("refuses %s KEK on restart without replacing it", async fault => {
    await migrate(db);
    await repo.createApiKey("test", "machine");
    await reopen();
    if (fault === "missing") fs.unlinkSync(kek);
    else fs.writeFileSync(kek, fault === "short" ? "invalid" : randomBytes(32));
    const contents = fault !== "missing" && fs.readFileSync(kek);
    await expect(migrate(db)).rejects.toThrow(kek);
    await expect(migrate(db)).rejects.toThrow(/restore.*backup/i);
    await expect(migrate(db)).rejects.toMatchObject({ code: "ERR_GATEWAY_DB_STARTUP" });
    if (contents) expect(fs.readFileSync(kek)).toEqual(contents);
    else expect(fs.existsSync(kek)).toBe(false);
  });

  it("encrypts JSON imports with fresh nonces and binds ciphertext to id and version", async () => {
    await migrate(db);
    expect(columns()).not.toContain("key");
    expect(fs.statSync(kek).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(kek)).toHaveLength(32);
    const first = await repo.createApiKey("one", "machine"), second = await repo.createApiKey("two", "machine");
    const read = id => db.get("SELECT key_ciphertext FROM apiKeys WHERE id=?", [id]).key_ciphertext;
    const before = read(first.id), dump = await repo.exportDb();
    expect(dump.apiKeys[0].key).toBe(first.key);
    expect(await repo.importDb(dump)).toEqual(dump);
    expect(read(first.id).split(":")[1]).not.toBe(before.split(":")[1]);
    const current = read(first.id);
    db.run("UPDATE apiKeys SET key_ciphertext=? WHERE id=?", [read(second.id), first.id]);
    expect(await repo.validateApiKey(first.key)).toBe(false);
    expect(await repo.validateApiKey(second.key)).toBe(true);
    db.run("UPDATE apiKeys SET key_ciphertext=?,key_version=2 WHERE id=?", [current, first.id]);
    vi.stubEnv("API_KEY_SECRET", "fixture-replaced");
    await reopen(); await migrate(db);
    expect(await repo.getApiKeys()).toEqual([expect.objectContaining({ id: first.id, isActive: false, key: null, keyError: "decryption_failed" }),
      expect.objectContaining({ id: second.id, key: second.key })]);
    expect(await repo.validateApiKey(first.key)).toBe(false);
    expect(await repo.validateApiKey(second.key)).toBe(true);
    expect(await repo.getApiKeySummaries()).toEqual([expect.objectContaining({ id: first.id, isActive: false }),
      expect.objectContaining({ id: second.id, isActive: true })]);
    const query = vi.spyOn(db, "get");
    const scan = vi.spyOn(db, "all");
    expect(await repo.validateApiKey("invalid-bearer")).toBe(false);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["SELECT * FROM apiKeys WHERE key_verifier=?"]);
    expect(scan).not.toHaveBeenCalled();
  });
});
