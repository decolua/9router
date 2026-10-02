import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real SQLite repository and migration code, not a SQL mock.
// Only adapter selection is replaced, ensuring these tests cannot open a user's DB.
const state = vi.hoisted(() => ({ adapter: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => state.adapter }));

const unrestricted = {
  providerIds: [], models: [], forceProviderId: "", forceModel: "",
};
const policy = {
  providerIds: ["openai-compatible-test"],
  models: ["openai-compatible-test/model-a"],
  forceProviderId: "openai-compatible-test",
  forceModel: "local/model-a",
};
let tempDir;
let createAdapter;
let runMigrationOnce;
let repo;
let listeners;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-policy-"));
  process.env.DATA_DIR = tempDir;
  listeners = Object.fromEntries(["beforeExit", "SIGINT", "SIGTERM"]
    .map((event) => [event, process.listeners(event)]));
  vi.resetModules();
  ({ createSqlJsAdapter: createAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js"));
  ({ runMigrationOnce } = await import("@/lib/db/migrate.js"));
  state.adapter = await createAdapter(path.join(tempDir, "test.sqlite"));
  repo = await import("@/lib/db/repos/apiKeysRepo.js");
});

afterEach(() => {
  state.adapter?.close();
  state.adapter = null;
  // sql.js installs shutdown handlers; don't retain closed test adapters.
  for (const [event, previous] of Object.entries(listeners || {})) {
    for (const listener of process.listeners(event)) {
      if (!previous.includes(listener)) process.removeListener(event, listener);
    }
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API-key permissions in SQLite", () => {
  it("upgrades a pre-permissions SQLite database without restricting or changing existing keys", async () => {
    const { TABLES, buildCreateTableSql } = await import("@/lib/db/schema.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    for (const [name, definition] of Object.entries(TABLES)) {
      const columns = { ...definition.columns };
      if (name === "apiKeys") delete columns.permissions;
      state.adapter.exec(buildCreateTableSql(name, { ...definition, columns }));
    }
    state.adapter.run("INSERT INTO _meta(key, value) VALUES('schemaVersion', ?)", [String(latestVersion())]);
    state.adapter.run("INSERT INTO _meta(key, value) VALUES('backupSchemaVersion', '1')");
    state.adapter.run("INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)",
      ["old-key", "sk-existing", "Existing key", "machine-before", 1, "2025-01-01T00:00:00.000Z"]);

    await runMigrationOnce(state.adapter);

    expect(state.adapter.all("PRAGMA table_info(apiKeys)").map((column) => column.name)).toContain("permissions");
    expect(await repo.getApiKeyByValue("sk-existing")).toEqual({
      id: "old-key", key: "sk-existing", name: "Existing key", machineId: "machine-before",
      isActive: true, createdAt: "2025-01-01T00:00:00.000Z", permissions: unrestricted,
    });
    expect(await repo.validateApiKey("sk-existing")).toBe(true);
    expect(await repo.getApiKeyByValue("sk-missing")).toBeNull();
  });

  it("persists normalized permissions through create, update, and a SQLite file reopen", async () => {
    await runMigrationOnce(state.adapter);
    const key = await repo.createApiKey("Policy key", "testmachine00001", {
      ...policy, providerIds: [" openai-compatible-test ", "openai-compatible-test", null],
    });
    expect(key.permissions).toEqual(policy);
    expect(JSON.parse(state.adapter.get("SELECT permissions FROM apiKeys WHERE id = ?", [key.id]).permissions)).toEqual(policy);
    expect((await repo.getApiKeyById(key.id)).permissions).toEqual(policy);

    const updatedPolicy = { ...policy, models: [], forceModel: "local/model-b" };
    const updated = await repo.updateApiKey(key.id, { permissions: updatedPolicy });
    expect(updated.permissions).toEqual(updatedPolicy);
    await repo.updateApiKey(key.id, { name: "Renamed" });
    state.adapter.close();
    state.adapter = await createAdapter(path.join(tempDir, "test.sqlite"));
    await runMigrationOnce(state.adapter);

    expect(await repo.getApiKeyByValue(key.key)).toMatchObject({ name: "Renamed", permissions: updatedPolicy });
    expect(await repo.validateApiKey(key.key)).toBe(true);
    expect(await repo.updateApiKey("missing", { permissions: policy })).toBeNull();
    await repo.updateApiKey(key.id, { isActive: false });
    expect(await repo.validateApiKey(key.key)).toBe(false);
    expect(await repo.deleteApiKey(key.id)).toBe(true);
    expect(await repo.getApiKeyByValue(key.key)).toBeNull();
  });

  it("round-trips both restricted and unrestricted keys through database export/import", async () => {
    await runMigrationOnce(state.adapter);
    const restricted = await repo.createApiKey("Restricted", "testmachine00001", policy);
    const oldStyle = await repo.createApiKey("Unrestricted", "testmachine00002");
    await repo.updateApiKey(restricted.id, { isActive: false });
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const snapshot = await exportDb();
    expect(snapshot.apiKeys.find((key) => key.id === restricted.id)).toMatchObject({ permissions: policy, isActive: false });
    await repo.deleteApiKey(restricted.id);
    await repo.updateApiKey(oldStyle.id, { permissions: policy });
    await importDb(snapshot);

    expect(await repo.getApiKeyByValue(restricted.key)).toMatchObject({ permissions: policy, isActive: false });
    expect(await repo.getApiKeyByValue(oldStyle.key)).toMatchObject({ permissions: unrestricted, isActive: true });
    expect((await exportDb()).apiKeys).toEqual(snapshot.apiKeys);
  });

  it("imports legacy JSON keys with and without policies", async () => {
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({ apiKeys: [
      { id: "legacy-open", key: "sk-legacy-open", name: "Legacy open" },
      { id: "legacy-policy", key: "sk-legacy-policy", name: "Legacy policy", permissions: policy },
    ] }));
    await runMigrationOnce(state.adapter);
    expect((await repo.getApiKeyByValue("sk-legacy-open")).permissions).toEqual(unrestricted);
    expect((await repo.getApiKeyByValue("sk-legacy-policy")).permissions).toEqual(policy);
    expect(await repo.getApiKeys()).toHaveLength(2);
    expect(fs.existsSync(path.join(tempDir, "db", ".migrated-from-json"))).toBe(true);
  });

  it("keeps old exports without permissions unrestricted when imported", async () => {
    await runMigrationOnce(state.adapter);
    const { importDb } = await import("@/lib/db/index.js");
    await importDb({ apiKeys: [{ id: "old-export", key: "sk-old-export", name: "Old export" }] });
    expect((await repo.getApiKeyByValue("sk-old-export")).permissions).toEqual(unrestricted);
    expect(await repo.validateApiKey("sk-old-export")).toBe(true);
  });
});
