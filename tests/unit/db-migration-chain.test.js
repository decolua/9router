// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("classifies an unwritable backup root as fatal before migrating plaintext keys", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir);
    const fixture = new DatabaseSync(path.join(dbDir, "data.sqlite"));
    fixture.exec("CREATE TABLE _meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO _meta VALUES('schemaVersion','5'); CREATE TABLE apiKeys(key TEXT)");
    fixture.close();
    const mkdir = fs.mkdirSync;
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementation((dir, ...args) => {
      if (dir === path.join(dbDir, "backups")) throw new Error("fixture: read-only backup directory");
      return mkdir(dir, ...args);
    });
    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      await expect(getAdapter()).rejects.toMatchObject({
        code: "ERR_GATEWAY_DB_STARTUP", cause: { message: "fixture: read-only backup directory" },
      });
    } finally { spy.mockRestore(); }
    const saved = new DatabaseSync(path.join(dbDir, "data.sqlite"), { readOnly: true });
    try { expect(saved.prepare("SELECT value FROM _meta WHERE key='schemaVersion'").get().value).toBe("5"); }
    finally { saved.close(); }
  });

  it.each(["schemaVersion", "backupSchemaVersion"])("refuses a newer %s without overwriting it", async name => {
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    db.run("UPDATE _meta SET value='999' WHERE key=?", [name]);
    vi.resetModules();
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    await expect(runMigrationOnce(db)).rejects.toMatchObject({
      code: "ERR_GATEWAY_DB_STARTUP", message: expect.stringContaining(name),
    });
    expect(db.get("SELECT value FROM _meta WHERE key=?", [name]).value).toBe("999");
  });

  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails", "auditLog", "notifications", "notificationChannels", "notificationMutes",
    ]));
  });

  it("upgrades v6 usage rows to nullable indexed IDs; replay leaves data intact", async () => {
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    db.exec("DROP INDEX idx_uh_request; ALTER TABLE usageHistory DROP COLUMN requestId");
    db.run("INSERT INTO usageHistory(timestamp,cost) VALUES('2026-01-01', 1.5)");
    db.run("UPDATE _meta SET value='6' WHERE key='schemaVersion'");
    db.close();
    delete global._dbAdapter;
    vi.resetModules();
    const upgraded = await (await import("@/lib/db/driver.js")).getAdapter();
    (await import("@/lib/db/migrations/007-request-id.js")).default.up(upgraded);
    expect(upgraded.get("SELECT requestId,cost FROM usageHistory")).toMatchObject({ requestId: null, cost: 1.5 });
    expect(upgraded.all("PRAGMA index_info(idx_uh_request)").map(c => c.name)).toEqual(["requestId"]);
    expect(upgraded.get("SELECT value FROM _meta WHERE key='schemaVersion'").value).toBe("11");
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: { foo: "legacy-value" },
      apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "legacy-value" });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty("key");
    const { getApiKeyByKey } = await import("@/lib/db/index.js");
    expect(await getApiKeyByKey("abc")).toMatchObject({ id: "k1", key: "abc" });

    const aliases = db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases).toHaveLength(1);
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});

it.each([8, 9])("upgrades v%i keys without changing credentials; ownership migration can replay", async version => {
  const db = await (await import("@/lib/db/driver.js")).getAdapter();
  const key = await (await import("@/lib/db/index.js")).createApiKey("legacy", "fixture");
  const before = db.get("SELECT key_ciphertext,key_verifier FROM apiKeys WHERE id=?", [key.id]);
  for (const field of ["description", "owner", "project"]) db.exec(`ALTER TABLE apiKeys DROP COLUMN ${field}`);
  if (version === 8) db.exec("DROP TABLE notifications");
  db.run("UPDATE _meta SET value=? WHERE key='schemaVersion'", [String(version)]);
  db.close();
  delete global._dbAdapter;
  vi.resetModules();
  const upgraded = await (await import("@/lib/db/driver.js")).getAdapter();
  const migration = (await import("@/lib/db/migrations/010-key-ownership.js")).default;
  expect(upgraded.get("SELECT key_ciphertext,key_verifier,description,owner,project FROM apiKeys WHERE id=?", [key.id]))
    .toEqual({ ...before, description: null, owner: null, project: null });
  upgraded.run("UPDATE apiKeys SET project='Blue' WHERE id=?", [key.id]);
  migration.up(upgraded);
  expect((await (await import("@/lib/db/index.js")).getApiKeyByKey(key.key)).project).toBe("Blue");
  expect(upgraded.get("SELECT value FROM _meta WHERE key='schemaVersion'").value).toBe("11");
});

it("upgrades v10 keys in place and makes a pre-upgrade backup", async () => {
  const db = await (await import("@/lib/db/driver.js")).getAdapter();
  const key = await (await import("@/lib/db/index.js")).createApiKey("legacy", "machine", { project: "Blue" });
  for (const field of ["allowedConnections", "connectionProviders"]) db.exec(`ALTER TABLE apiKeys DROP COLUMN ${field}`);
  db.run("UPDATE _meta SET value='10' WHERE key IN ('schemaVersion', 'backupSchemaVersion')");
  const before = db.get("SELECT * FROM apiKeys WHERE id=?", [key.id]);
  db.close();
  delete global._dbAdapter;
  vi.resetModules();
  const upgraded = await (await import("@/lib/db/driver.js")).getAdapter();
  expect(upgraded.get("SELECT * FROM apiKeys WHERE id=?", [key.id])).toEqual({
    ...before, allowedConnections: null, connectionProviders: null,
  });
  expect(fs.readdirSync(path.join(tempDir, "db/backups")).some(name => name.startsWith("schema-10-to-11"))).toBe(true);
});
