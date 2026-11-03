// Per-API-key access control: a DB written by the previous schema (apiKeys
// without the access columns, schemaVersion 1) upgrades in place; every existing
// key stays unrestricted. Backup export/import carries access, and older backups restore
// as unrestricted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeLegacyDb(dir) {
  // The apiKeys DDL as it was before the access columns + a stamped v1 _meta.
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '1'), ('backupSchemaVersion', '1')`);
  db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`);
  const ins = db.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)`);
  ins.run("k1", "sk-legacy-one", "Default Key", "m", 1, "2026-09-01T00:00:00.000Z");
  ins.run("k2", "sk-legacy-two", "paused", "m", 0, "2026-09-02T00:00:00.000Z");
  db.close();
}

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { db, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-access-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("version-zero usage upgrade", () => {
  it("retains populated history before adding request identity and its unique index", async () => {
    fs.mkdirSync(path.join(tempDir, "db"), { recursive: true });
    const seed = new DatabaseSync(path.join(tempDir, "db", "data.sqlite"));
    seed.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    seed.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '0'), ('backupSchemaVersion', '0')`);
    seed.exec(`CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT)`);
    seed.exec(`INSERT INTO usageHistory(timestamp, provider, model, apiKey, tokens) VALUES ('2026-01-01T00:00:00.000Z', 'xai', 'video', 'sk-one', '{}'), ('2026-01-01T00:00:00.000Z', 'xai', 'video', 'sk-one', '{}')`);
    seed.close();
    const { adapter } = await boot();
    expect(adapter.all(`SELECT id, requestId FROM usageHistory ORDER BY id`)).toEqual([{ id: 1, requestId: null }, { id: 2, requestId: null }]);
    expect(adapter.all(`PRAGMA index_list(usageHistory)`).some((index) => index.name === "idx_uh_request_id" && index.unique === 1)).toBe(true);
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("6");
  });
});

describe("canonical policy backfill", () => {
  it("copies legacy allow entries without changing canonical restrictions or expiry and limits, even when rerun", async () => {
    writeLegacyDb(tempDir);
    const seed = new DatabaseSync(path.join(tempDir, "db", "data.sqlite"));
    for (const column of ["allowedModels TEXT", "accessRestricted INTEGER DEFAULT 0", "accessAllow TEXT", "expiresAt TEXT", "maxRequestsPerDay INTEGER", "maxSpendUsdPerDay REAL"]) {
      seed.exec(`ALTER TABLE apiKeys ADD COLUMN ${column}`);
    }
    seed.prepare(`UPDATE apiKeys SET allowedModels = ?, expiresAt = ?, maxRequestsPerDay = ? WHERE id = ?`)
      .run('["kr/*"]', "2030-01-01T00:00:00.000Z", 7, "k1");
    seed.prepare(`UPDATE apiKeys SET allowedModels = ?, accessRestricted = 1, accessAllow = ?, maxSpendUsdPerDay = ? WHERE id = ?`)
      .run('["kr/*"]', '["Main"]', 2.5, "k2");
    seed.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("k3", "sk-empty-legacy", "empty", "m", 1, "2026-09-03T00:00:00.000Z", "[]");
    seed.exec(`UPDATE _meta SET value = '4' WHERE key = 'schemaVersion'`);
    seed.close();
    const { db, adapter } = await boot();
    const migration = (await import("@/lib/db/migrations/005-canonical-key-policy.js")).default;
    migration.up(adapter);
    expect((await db.getApiKeyById("k1")).access).toEqual({ restricted: true, allow: ["kr/*"] });
    expect((await db.getApiKeyById("k1")).expiresAt).toBe("2030-01-01T00:00:00.000Z");
    expect((await db.getApiKeyById("k1")).maxRequestsPerDay).toBe(7);
    expect(adapter.get(`SELECT accessAllow FROM apiKeys WHERE id = ?`, ["k2"]).accessAllow).toBe('["Main"]');
    expect((await db.getApiKeyById("k2")).maxSpendUsdPerDay).toBe(2.5);
    expect((await db.getApiKeyById("k3")).access).toEqual({ restricted: false, allow: [] });
    expect(adapter.all(`PRAGMA table_info(apiKeys)`).map((column) => column.name))
      .toEqual(expect.arrayContaining(["allowedModels", "blockedModels", "allowedCombos", "accessRestricted", "accessAllow"]));
  });
});

describe("apiKeys access columns: upgrade from the previous schema", () => {
  it("adds the columns, keeps every row, and reads every existing key as unrestricted", async () => {
    writeLegacyDb(tempDir);
    const { db, adapter } = await boot();

    const usageColumns = adapter.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name);
    expect(usageColumns).toContain("requestId");
    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["accessRestricted", "accessAllow"]));

    const keys = await db.getApiKeys();
    expect(keys.map((k) => [k.id, k.name, k.isActive, k.access])).toEqual([
      ["k1", "Default Key", true, { restricted: false, allow: [] }],
      ["k2", "paused", false, { restricted: false, allow: [] }],
    ]);
    expect(await db.validateApiKey("sk-legacy-one")).toBe(true);
    expect((await db.getApiKeyByKey("sk-legacy-one")).access.restricted).toBe(false);

    // The schema bump took the pre-change safety backup (schema.js SCHEMA_VERSION is 6).
    const backups = fs.readdirSync(path.join(tempDir, "db", "backups"));
    expect(backups.some((d) => d.startsWith("schema-1-to-6"))).toBe(true);
  });

  it("keeps identical-looking distinct requests and deduplicates a genuine repeated request id", async () => {
    writeLegacyDb(tempDir);
    const { adapter } = await boot();
    const { saveRequestUsage, getDailyUsageForApiKey } = await import("@/lib/db/repos/usageRepo.js");
    const base = { timestamp: new Date().toISOString(), provider: "xai", model: "video", apiKey: "sk-legacy-one", tokens: {}, status: "success" };
    await saveRequestUsage({ ...base, requestId: "request-a" });
    await saveRequestUsage({ ...base, requestId: "request-b" });
    await saveRequestUsage({ ...base, requestId: "request-a" });
    await saveRequestUsage({ ...base });
    await saveRequestUsage({ ...base });
    expect(adapter.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE apiKey = ?`, [base.apiKey]).count).toBe(4);
    expect((await getDailyUsageForApiKey(base.apiKey)).requests).toBe(4);
    expect(adapter.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE requestId = ?`, ["request-a"]).count).toBe(1);
    expect(adapter.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE requestId IS NULL`).count).toBe(2);
  });

  it("a successful speech usage write reaches the canonical daily cap through real storage", async () => {
    writeLegacyDb(tempDir);
    await boot();
    const { updateApiKey, getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { saveRequestUsage, getDailyUsageForApiKey } = await import("@/lib/db/repos/usageRepo.js");
    const { enforceKeyPolicy } = await import("@/sse/services/keyAccess.js");
    const apiKey = "sk-legacy-one";
    await updateApiKey("k1", { maxRequestsPerDay: 1 });
    const key = await getApiKeyByKey(apiKey);
    const ctx = { apiKey, expiresAt: key.expiresAt, maxRequestsPerDay: key.maxRequestsPerDay, maxSpendUsdPerDay: key.maxSpendUsdPerDay };
    expect(await enforceKeyPolicy(ctx)).toBeNull();
    await saveRequestUsage({ provider: "openai", model: "tts-1", apiKey, endpoint: "/v1/audio/speech", tokens: {}, status: "success" });
    expect((await getDailyUsageForApiKey(apiKey)).requests).toBe(1);
    expect((await enforceKeyPolicy(ctx)).status).toBe(429);
  });

  it("fails closed when the capped-key daily usage read fails", async () => {
    writeLegacyDb(tempDir);
    const { adapter } = await boot();
    const { enforceKeyPolicy } = await import("@/sse/services/keyAccess.js");
    const originalGet = adapter.get.bind(adapter);
    const failingGet = vi.spyOn(adapter, "get").mockImplementation((sql, ...args) => {
      if (sql.includes("FROM usageDaily")) throw new Error("storage unavailable");
      return originalGet(sql, ...args);
    });
    try {
      expect((await enforceKeyPolicy({ apiKey: "sk-legacy-one", maxRequestsPerDay: 1 })).status).toBe(503);
    } finally {
      failingGet.mockRestore();
    }
  });

  it("reads the provider-only connection projection and counts persisted keyed success", async () => {
    writeLegacyDb(tempDir);
    const { db, adapter } = await boot();
    adapter.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["video-1", "xai", "apikey", "video", 1, '{"accessToken":"private"}', new Date().toISOString(), new Date().toISOString()],
    );
    const { getProviderConnectionProviderById } = await import("@/lib/db/repos/connectionsRepo.js");
    const { saveRequestUsage, getDailyUsageForApiKey } = await import("@/lib/db/repos/usageRepo.js");
    expect(await getProviderConnectionProviderById("video-1")).toBe("xai");
    expect(await getProviderConnectionProviderById("missing")).toBeNull();
    await saveRequestUsage({ provider: "xai", model: "video", connectionId: "video-1", apiKey: "sk-legacy-one", endpoint: "/v1/videos/generations", tokens: {}, status: "success" });
    expect((await getDailyUsageForApiKey("sk-legacy-one")).requests).toBe(1);
    await saveRequestUsage({ provider: "gemini", model: "gemini-2.5-flash-preview-tts", apiKey: "sk-legacy-two", endpoint: "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", tokens: { prompt_tokens: 2, completion_tokens: 1 }, status: "success" });
    expect((await getDailyUsageForApiKey("sk-legacy-two")).requests).toBe(1);
    expect((await getDailyUsageForApiKey("sk-legacy-one")).requests).toBe(1);
  });

  it("translates legacy writes at creation and update without overriding explicit canonical access", async () => {
    writeLegacyDb(tempDir);
    const { db } = await boot();
    const created = await db.createApiKey("legacy", "m", { allowedModels: ["kr/*"] });
    expect(created.access).toEqual({ restricted: true, allow: ["kr/*"] });
    expect((await db.getApiKeyById(created.id)).access).toEqual(created.access);
    expect((await db.updateApiKey(created.id, { allowedModels: ["cx/*"] })).access)
      .toEqual({ restricted: true, allow: ["cx/*"] });
    expect((await db.updateApiKey(created.id, { allowedModels: ["kr/*"], access: { restricted: true, allow: ["Main"] } })).access)
      .toEqual({ restricted: true, allow: ["Main"] });
    expect((await db.updateApiKey(created.id, { name: "renamed" })).access)
      .toEqual({ restricted: true, allow: ["Main"] });
    expect((await db.updateApiKey(created.id, { allowedModels: [] })).access)
      .toEqual({ restricted: false, allow: [] });
  });

  it("persists access through update, new keys default to unrestricted", async () => {
    writeLegacyDb(tempDir);
    const { db } = await boot();
    const updated = await db.updateApiKey("k1", { access: { restricted: true, allow: ["Main", "cx/gpt-5"] } });
    expect(updated.access).toEqual({ restricted: true, allow: ["Main", "cx/gpt-5"] });
    expect((await db.getApiKeyById("k1")).access).toEqual({ restricted: true, allow: ["Main", "cx/gpt-5"] });
    // Unrelated updates (pause/resume) keep the access.
    await db.updateApiKey("k1", { isActive: false });
    expect((await db.getApiKeyById("k1")).access.restricted).toBe(true);

    const created = await db.createApiKey("fresh", "machine-1");
    expect(created.access).toEqual({ restricted: false, allow: [] });
    expect((await db.getApiKeyById(created.id)).access).toEqual({ restricted: false, allow: [] });
  });

  it("export/import round-trips access; a backup without access restores unrestricted; malformed access is refused", async () => {
    writeLegacyDb(tempDir);
    const { db } = await boot();
    await db.updateApiKey("k1", { access: { restricted: true, allow: ["Main"] } });
    const dump = await db.exportDb();
    expect(dump.apiKeys.find((k) => k.id === "k1").access).toEqual({ restricted: true, allow: ["Main"] });

    await db.importDb(dump);
    expect((await db.getApiKeyById("k1")).access).toEqual({ restricted: true, allow: ["Main"] });

    const legacy = { ...dump, apiKeys: dump.apiKeys.map(({ access, ...rest }) => rest) };
    await db.importDb(legacy);
    expect((await db.getApiKeyById("k1")).access).toEqual({ restricted: false, allow: [] });

    const bad = { ...dump, apiKeys: [{ ...dump.apiKeys[0], access: { restricted: "yes", allow: [] } }] };
    await expect(db.importDb(bad)).rejects.toThrow(/access/);
    // The failed import rolled back: the previous rows are still there.
    expect((await db.getApiKeys()).length).toBe(2);
  });
});
