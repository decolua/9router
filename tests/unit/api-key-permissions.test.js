// API key permissions: model allow-list + expiry + presets.
// Exercises the real SQLite adapter (temp DATA_DIR), same pattern as
// request-details-tab.test.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-perms-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(() => {
  try {
    if (adapter?.close) adapter.close();
    if (adapter?.dispose) adapter.dispose();
  } catch { /* best effort */ }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* locked on win */ }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("api key permissions", () => {
  it("isModelAllowedForKey: null allows all, empty denies all", () => {
    expect(db.isModelAllowedForKey({ allowedModels: null }, "anything/model-x")).toBe(true);
    expect(db.isModelAllowedForKey({ allowedModels: [] }, "anything/model-x")).toBe(false);
    expect(db.isModelAllowedForKey(null, "m")).toBe(false);
  });

  it("isModelAllowedForKey: matches full, bare, and combo entries", () => {
    const row = { allowedModels: ["openai/gpt-4o", "my-combo"] };
    expect(db.isModelAllowedForKey(row, "gpt-4o")).toBe(true);
    expect(db.isModelAllowedForKey(row, "openai/gpt-4o")).toBe(true);
    expect(db.isModelAllowedForKey(row, "my-combo")).toBe(true);
    expect(db.isModelAllowedForKey(row, "claude-3-5-sonnet")).toBe(false);
  });

  it("isKeyExpired: past expiry is expired, future/null is not", () => {
    expect(db.isKeyExpired("2020-01-01T00:00:00.000Z")).toBe(true);
    expect(db.isKeyExpired("2999-01-01T00:00:00.000Z")).toBe(false);
    expect(db.isKeyExpired(null)).toBe(false);
  });

  it("create/update round-trips allowedModels + expiresAt", async () => {
    const key = await db.createApiKey("Test Key", "machine-123", {
      allowedModels: ["openai/gpt-4o"],
      expiresAt: "2030-01-01T23:59:59.999Z",
    });
    expect(key.allowedModels).toEqual(["openai/gpt-4o"]);
    expect(key.expiresAt).toBe("2030-01-01T23:59:59.999Z");

    const fetched = await db.getApiKeyById(key.id);
    expect(fetched.allowedModels).toEqual(["openai/gpt-4o"]);
    expect(fetched.expiresAt).toBe("2030-01-01T23:59:59.999Z");

    // validateApiKey respects expiry
    expect(await db.validateApiKey(key.key)).toBe(true);
    const updated = await db.updateApiKey(key.id, { expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(updated.expiresAt).toBe("2020-01-01T00:00:00.000Z");
    expect(await db.validateApiKey(key.key)).toBe(false);
  });

  it("key presets CRUD", async () => {
    const preset = await db.createKeyPreset({ name: "Coding", models: ["openai/gpt-4o", "my-combo"] });
    expect(preset.name).toBe("Coding");
    expect(preset.models).toEqual(["openai/gpt-4o", "my-combo"]);

    const list = await db.getKeyPresets();
    expect(list.some((p) => p.id === preset.id)).toBe(true);

    const updated = await db.updateKeyPreset(preset.id, { models: ["gpt-4o"] });
    expect(updated.models).toEqual(["gpt-4o"]);

    expect(await db.deleteKeyPreset(preset.id)).toBe(true);
    expect(await db.getKeyPresetById(preset.id)).toBeNull();
  });
});
