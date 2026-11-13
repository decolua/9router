import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "quota-test-machine" }));

let tempDir;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-quota-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function boot() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  const routes = await import("@/app/api/keys/route.js");
  const item = await import("@/app/api/keys/[id]/route.js");
  return { db, routes, item };
}
const request = (body, method = "POST") => new Request("http://localhost/api/keys", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const usage = (key, tokens, timestamp = "2026-10-23T01:00:00.000Z") => ({
  apiKey: key, provider: "openai", model: "gpt-4o", tokens, timestamp, status: "ok",
});

describe("API key quotas and canonical access", () => {
  it("creates a restricted key through POST and keeps its rules after a rename", async () => {
    const { db, routes, item } = await boot();
    const access = { restricted: true, allow: ["oc/*", "-haiku"] };
    const created = await routes.POST(request({ name: "Shared", tokenLimit: 1000, access }));
    expect(created.status).toBe(201);
    const key = await created.json();
    expect(key).toMatchObject({ tokenLimit: 1000, usedTokens: 0, access });
    expect((await db.getApiKeyById(key.id)).access).toEqual(access);

    await db.saveRequestUsage(usage(key.key, { input_tokens: 120, output_tokens: 30 }));
    const updated = await item.PUT(request({ name: "Renamed", tokenLimit: 2000 }, "PUT"), { params: Promise.resolve({ id: key.id }) });
    expect(updated.status).toBe(200);
    expect((await updated.json()).key).toMatchObject({ name: "Renamed", usedTokens: 150, tokenLimit: 2000, access });
  });

  it("counts exact input/output once, blocks at the quota, and unblocks after an explicit reset", async () => {
    const { db, item } = await boot();
    const { checkApiKeyQuota } = await import("@/sse/services/auth.js");
    const key = await db.createApiKey("Limited", "test-machine", { tokenLimit: 150 });
    const entry = usage(`  ${key.key}  `, { prompt_tokens: 120, completion_tokens: 30 });
    await db.saveRequestUsage({ ...entry });
    await db.saveRequestUsage({ ...entry });
    expect((await db.getApiKeyById(key.id)).usedTokens).toBe(150);
    expect((await checkApiKeyQuota(key.key, false)).status).toBe(429);
    const reset = await item.PUT(request({ usedTokens: 0 }, "PUT"), { params: Promise.resolve({ id: key.id }) });
    expect((await reset.json()).key.usedTokens).toBe(0);
    expect(await checkApiKeyQuota(key.key, true)).toBeNull();

    await db.saveRequestUsage(usage(key.key, {}, "2026-10-23T01:01:00.000Z"));
    expect((await db.getApiKeyById(key.id)).usedTokens).toBe(0);
  });

  it("keeps unlimited keys usable and supports legacy API input and backups", async () => {
    const { db, routes } = await boot();
    const { checkApiKeyQuota } = await import("@/sse/services/auth.js");
    const created = await routes.POST(request({ name: "Legacy", allowedModels: ["oc/*"] }));
    const key = await created.json();
    expect(key.access).toEqual({ restricted: true, allow: ["oc/*"] });
    await db.saveRequestUsage(usage(key.key, { input_tokens: 100, output_tokens: 200 }));
    expect(await checkApiKeyQuota(key.key, false)).toBeNull();
    const dump = await db.exportDb();
    await db.importDb(dump);
    expect(await db.getApiKeyById(key.id)).toMatchObject({ tokenLimit: 0, usedTokens: 300, access: key.access });
    const legacy = { ...dump, apiKeys: dump.apiKeys.map(({ access, ...rest }) => ({ ...rest, allowedModels: ["oc/*"] })) };
    await db.importDb(legacy);
    expect((await db.getApiKeyById(key.id)).access).toEqual(key.access);
  });

  it("rejects invalid quota numbers and keeps an explicitly empty restricted list closed", async () => {
    const { routes } = await boot();
    for (const tokenLimit of [-1, 1.5, "100", null]) {
      expect((await routes.POST(request({ name: "Invalid", tokenLimit }))).status).toBe(400);
    }
    const created = await routes.POST(request({ name: "Closed", access: { restricted: true, allow: [] }, allowedModels: ["*"] }));
    expect((await created.json()).access).toEqual({ restricted: true, allow: [] });
  });

  it("upgrades legacy stored rules without losing quotas or reactivating old rules on reboot", async () => {
    fs.mkdirSync(path.join(tempDir, "db"), { recursive: true });
    const sqlite = new DatabaseSync(path.join(tempDir, "db", "data.sqlite"));
    sqlite.exec(`CREATE TABLE _meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta VALUES ('schemaVersion', '2'), ('backupSchemaVersion', '2');
      CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL, tokenLimit INTEGER DEFAULT 0, usedTokens INTEGER DEFAULT 0, allowedModels TEXT,
        accessRestricted INTEGER DEFAULT 0, accessAllow TEXT);
      INSERT INTO apiKeys VALUES ('old', 'sk-old', 'Legacy', 'm', 1, '2026-09-01', 1000, 250, '["oc/*"]', 0, '[]');
      INSERT INTO apiKeys VALUES ('closed', 'sk-closed', 'Closed', 'm', 1, '2026-09-01', 500, 100, '["*"]', 1, '[]');`);
    sqlite.close();
    const { db } = await boot();
    expect(await db.getApiKeyById("old")).toMatchObject({ tokenLimit: 1000, usedTokens: 250, access: { restricted: true, allow: ["oc/*"] } });
    expect((await db.getApiKeyById("closed")).access).toEqual({ restricted: true, allow: [] });
    await db.updateApiKey("old", { access: { restricted: false, allow: [] } });
    const { getAdapter } = await import("@/lib/db/driver.js");
    expect((await getAdapter()).get("SELECT allowedModels FROM apiKeys WHERE id = 'old'").allowedModels).toBeNull();
    expect(fs.readdirSync(path.join(tempDir, "db", "backups")).some((name) => name.startsWith("schema-2-to-3"))).toBe(true);
  });
});
