import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const policy = { overrideEnabled: true, enabled: true, rtkEnabled: false, headroomEnabled: true, cavemanEnabled: false, ponytailEnabled: true };
const originalDataDir = process.env.DATA_DIR;
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-savers-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function boot() {
  const db = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { db, adapter: await getAdapter() };
}

describe("API key saver persistence", () => {
  it("upgrades schema 2 without changing keys or access and takes a backup", async () => {
    fs.mkdirSync(path.join(dir, "db"));
    const old = new DatabaseSync(path.join(dir, "db/data.sqlite"));
    old.exec(`CREATE TABLE _meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta VALUES('schemaVersion', '1'), ('backupSchemaVersion', '2');
      CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL, accessRestricted INTEGER DEFAULT 0, accessAllow TEXT);
      INSERT INTO apiKeys VALUES('one','sk-one','one','m',1,'2026-10-01',1,'["Main"]'),('two','sk-two','two','m',0,'2026-10-02',0,NULL);`);
    old.close();
    const { db, adapter } = await boot();
    expect(adapter.all("PRAGMA table_info(apiKeys)").map((c) => c.name)).toContain("tokenSaver");
    expect((await db.getApiKeys()).map((k) => [k.id, k.isActive, k.tokenSaver, k.access.restricted])).toEqual([
      ["one", true, null, true], ["two", false, null, false],
    ]);
    expect(fs.readdirSync(path.join(dir, "db/backups")).some((name) => name.startsWith("schema-2-to-3"))).toBe(true);
  });

  it("preserves policy across unrelated updates, reset and corrupt stored data", async () => {
    const { db, adapter } = await boot();
    const key = await db.createApiKey("test", "machine");
    expect(key.tokenSaver).toBeNull();
    await db.updateApiKey(key.id, { tokenSaver: policy });
    await db.updateApiKey(key.id, { access: { restricted: true, allow: ["Main"] }, isActive: false });
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    const masterOff = await db.updateApiKey(key.id, { tokenSaver: { ...policy, enabled: false } });
    expect(masterOff.tokenSaver).toEqual({ ...policy, enabled: false });
    const paused = { ...policy, overrideEnabled: false, enabled: false };
    const updated = await db.updateApiKey(key.id, { tokenSaver: paused });
    expect(updated).toMatchObject({ tokenSaver: paused, isActive: false, access: { restricted: true, allow: ["Main"] } });
    await expect(db.updateApiKey(key.id, { tokenSaver: { ...policy, enabled: "no" } })).rejects.toThrow(/boolean/);
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(paused);
    await db.updateApiKey(key.id, { tokenSaver: null });
    expect((await db.getApiKeyById(key.id)).tokenSaver).toBeNull();
    adapter.run("UPDATE apiKeys SET tokenSaver = ? WHERE id = ?", ["{broken", key.id]);
    expect((await db.getApiKeyById(key.id)).tokenSaver).toBeNull();
  });

  it("round-trips backups, inherits from old backups, and rolls back bad imports", async () => {
    const { db } = await boot();
    const key = await db.createApiKey("test", "machine");
    await db.updateApiKey(key.id, { tokenSaver: policy });
    const dump = await db.exportDb();
    expect(dump.apiKeys[0].tokenSaver).toEqual(policy);
    await db.importDb(dump);
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    await expect(db.importDb({ ...dump, apiKeys: [{ ...dump.apiKeys[0], tokenSaver: [] }] })).rejects.toThrow(/tokenSaver/);
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    await db.importDb({ ...dump, apiKeys: dump.apiKeys.map(({ tokenSaver, ...rest }) => rest) });
    expect((await db.getApiKeyById(key.id)).tokenSaver).toBeNull();
    await db.importDb(await db.exportDb());
    expect((await db.getApiKeyById(key.id)).tokenSaver).toBeNull();
  });

  it("legacy JSON files inherit without modifying the legacy importer", async () => {
    fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ apiKeys: [{ id: "legacy", key: "sk-legacy", name: "legacy" }] }));
    const { db } = await boot();
    expect((await db.getApiKeyById("legacy")).tokenSaver).toBeNull();
  });

  it("PUT validates policies, retains unrelated fields, and supports reset", async () => {
    const { db } = await boot();
    const key = await db.createApiKey("test", "machine");
    const route = await import("@/app/api/keys/[id]/route.js");
    const put = (body, id = key.id) => route.PUT(new Request("http://localhost/api/keys/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
    expect((await put({ tokenSaver: policy })).status).toBe(200);
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    for (const body of [null, [], { tokenSaver: {} }, { tokenSaver: { ...policy, enabled: "true" } }, { tokenSaver: { ...policy, customPromptEnabled: true } }]) {
      expect((await put(body)).status).toBe(400);
      expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    }
    await put({ isActive: false, access: { restricted: true, allow: ["Main"] } });
    expect((await db.getApiKeyById(key.id)).tokenSaver).toEqual(policy);
    expect((await put({ tokenSaver: policy }, "missing")).status).toBe(404);
    expect((await put({ tokenSaver: null })).status).toBe(200);
    expect((await db.getApiKeyById(key.id))).toMatchObject({ tokenSaver: null, isActive: false, access: { restricted: true } });
  });
});
