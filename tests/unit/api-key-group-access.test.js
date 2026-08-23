import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let dbApi;
let auth;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-access-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  dbApi = await import("@/lib/db/index.js");
  auth = await import("@/sse/services/auth.js");
  await dbApi.initDb();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key group access", () => {
  it("default group permits every model", async () => {
    const key = await dbApi.createApiKey("default-access", "machine-default");
    expect(await auth.isApiKeyModelAllowed(key.key, "openai/gpt-5")).toEqual({ allowed: true });
  });

  it("allows changing the default group used by newly created keys", async () => {
    const group = await dbApi.createApiKeyGroup({ name: "team-default", allowedModels: [], allowedCombos: [] });
    await dbApi.setDefaultApiKeyGroup(group.id);
    const key = await dbApi.createApiKey("new-default-key", "machine-new-default");
    expect(key.groupId).toBe(group.id);
    expect((await dbApi.getApiKeyGroups()).find((item) => item.id === group.id)?.isDefault).toBe(true);
    await dbApi.setDefaultApiKeyGroup("default");
  });

  it("restricted group permits only selected models and combos", async () => {
    const group = await dbApi.createApiKeyGroup({ name: "restricted", allowedModels: ["openai/gpt-5"], allowedCombos: ["coding"] });
    const key = await dbApi.createApiKey("restricted-key", "machine-restricted", group.id);
    expect((await auth.isApiKeyModelAllowed(key.key, "openai/gpt-5")).allowed).toBe(true);
    expect((await auth.isApiKeyModelAllowed(key.key, "anthropic/claude-sonnet-4")).allowed).toBe(false);
    expect((await auth.isApiKeyModelAllowed(key.key, null, "coding")).allowed).toBe(true);
    expect((await auth.isApiKeyModelAllowed(key.key, null, "unlisted-combo")).allowed).toBe(false);
  });

  it("a combo-only group does not implicitly permit every direct model", async () => {
    const group = await dbApi.createApiKeyGroup({ name: "combo-only", allowedModels: [], allowedCombos: ["coding"] });
    const key = await dbApi.createApiKey("combo-key", "machine-combo", group.id);
    expect((await auth.isApiKeyModelAllowed(key.key, "openai/gpt-5")).allowed).toBe(false);
    expect((await auth.isApiKeyModelAllowed(key.key, null, "coding")).allowed).toBe(true);
  });

  it("model list filtering keeps only group-approved direct models and combos", async () => {
    const { filterModelsByAccessPolicy } = await import("@/app/api/v1/models/route.js");
    const models = [
      { id: "openai/gpt-5", owned_by: "openai" },
      { id: "anthropic/claude-sonnet-4", owned_by: "anthropic" },
      { id: "coding", owned_by: "combo" },
      { id: "review", owned_by: "combo" },
    ];
    const filtered = filterModelsByAccessPolicy(models, { unrestricted: false, allowedModels: ["openai/gpt-5"], allowedCombos: ["coding"] });
    expect(filtered.map((model) => model.id)).toEqual(["openai/gpt-5", "coding"]);
  });
});
