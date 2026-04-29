// Smoke test for the SQLite migration: seed a temp DATA_DIR with
// representative legacy JSON files, boot the connection module once, and
// assert that the public APIs (localDb / usageDb) return the same shape
// the lowdb version did.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tempDir;
let originalDataDir;

const SEED_DB = {
  providerConnections: [
    {
      id: "conn-1",
      provider: "openai",
      authType: "apikey",
      name: "prod",
      priority: 1,
      isActive: true,
      apiKey: "sk-test-123",
      testStatus: "ok",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "conn-2",
      provider: "iflow",
      authType: "oauth",
      name: "user@example.com",
      email: "user@example.com",
      priority: 1,
      isActive: true,
      accessToken: "ax.eyJ",
      refreshToken: "rx.eyJ",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  providerNodes: [
    {
      id: "node-1",
      type: "openai",
      name: "My OpenAI",
      prefix: "oa",
      apiType: "openai",
      baseUrl: "https://api.openai.com/v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  proxyPools: [],
  modelAliases: { "alias-a": "openai/gpt-4o-mini" },
  mitmAlias: { "claude-code": { mappings: { opus: "cc/claude-opus-4-6" } } },
  combos: [
    {
      id: "combo-1",
      name: "premium",
      models: ["cc/claude-opus-4-6", "if/kimi-k2-thinking"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  apiKeys: [
    {
      id: "key-1",
      name: "CLI",
      key: "sk_9router_test",
      machineId: "abc",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  settings: {
    cloudEnabled: false,
    requireLogin: true,
    providerStrategies: { openai: "round_robin" },
  },
  pricing: {
    openai: { "gpt-4o-mini": { input: 0.15, output: 0.6 } },
  },
};

const SEED_USAGE = {
  history: [
    {
      timestamp: "2026-04-01T10:00:00.000Z",
      provider: "openai",
      model: "gpt-4o-mini",
      connectionId: "conn-1",
      apiKey: "sk_9router_test",
      endpoint: "/v1/chat/completions",
      status: "200 OK",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.00005,
    },
  ],
  totalRequestsLifetime: 42,
  dailySummary: {},
};

const SEED_REQUEST_DETAILS = {
  records: [
    {
      id: "2026-04-01T10:00:00.000Z-abc123-gpt-4o-mini",
      timestamp: "2026-04-01T10:00:00.000Z",
      provider: "openai",
      model: "gpt-4o-mini",
      connectionId: "conn-1",
      status: "200 OK",
      latency: { total: 523 },
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      request: { method: "POST" },
      providerRequest: {},
      providerResponse: {},
      response: {},
    },
  ],
};

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqlite-test-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(SEED_DB));
  fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify(SEED_USAGE));
  fs.writeFileSync(path.join(tempDir, "request-details.json"), JSON.stringify(SEED_REQUEST_DETAILS));
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/sqlite/connection.js");
  closeDatabase();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

describe("SQLite migration from legacy JSON", () => {
  it("creates the SQLite file and backs up legacy JSON on first boot", async () => {
    // Trigger the migration by importing a module that opens the DB.
    const { getDatabase, SQLITE_FILE } = await import("@/lib/sqlite/connection.js");
    getDatabase();

    expect(fs.existsSync(SQLITE_FILE)).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "db.json.bak"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "usage.json.bak"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "request-details.json.bak"))).toBe(true);
  });

  it("surfaces provider connections with original shape", async () => {
    const { getProviderConnections } = await import("@/lib/localDb.js");
    const list = await getProviderConnections({ provider: "openai" });
    expect(list).toHaveLength(1);
    const c = list[0];
    expect(c.id).toBe("conn-1");
    expect(c.provider).toBe("openai");
    expect(c.authType).toBe("apikey");
    expect(c.name).toBe("prod");
    expect(c.isActive).toBe(true);
    expect(c.apiKey).toBe("sk-test-123");
    expect(c.testStatus).toBe("ok");
  });

  it("preserves model aliases, combos, api keys", async () => {
    const { getModelAliases, getCombos, validateApiKey } = await import("@/lib/localDb.js");
    const aliases = await getModelAliases();
    expect(aliases["alias-a"]).toBe("openai/gpt-4o-mini");

    const combos = await getCombos();
    expect(combos).toHaveLength(1);
    expect(combos[0].name).toBe("premium");
    expect(combos[0].models).toEqual(["cc/claude-opus-4-6", "if/kimi-k2-thinking"]);

    expect(await validateApiKey("sk_9router_test")).toBe(true);
    expect(await validateApiKey("wrong")).toBe(false);
  });

  it("round-trips settings and pricing", async () => {
    const { getSettings, getPricingForModel } = await import("@/lib/localDb.js");
    const settings = await getSettings();
    expect(settings.requireLogin).toBe(true);
    expect(settings.providerStrategies).toEqual({ openai: "round_robin" });

    const p = await getPricingForModel("openai", "gpt-4o-mini");
    expect(p).toMatchObject({ input: 0.15, output: 0.6 });
  });

  it("migrates usage history and lifetime counter", async () => {
    const { getUsageHistory, getUsageStats } = await import("@/lib/usageDb.js");
    const hist = await getUsageHistory();
    expect(hist.length).toBeGreaterThanOrEqual(1);

    const stats = await getUsageStats("all");
    expect(stats.totalRequests).toBe(42);
  });

  it("migrates request-details records", async () => {
    const { getRequestDetails } = await import("@/lib/requestDetailsDb.js");
    const { details, pagination } = await getRequestDetails({});
    expect(pagination.totalItems).toBeGreaterThanOrEqual(1);
    expect(details[0].id).toBe("2026-04-01T10:00:00.000Z-abc123-gpt-4o-mini");
    expect(details[0].provider).toBe("openai");
  });

  it("supports fresh CRUD on an already-migrated DB", async () => {
    const { createCombo, deleteCombo, getComboByName } = await import("@/lib/localDb.js");
    const created = await createCombo({ name: "test-combo", models: ["a", "b"] });
    expect(created.id).toBeDefined();
    const fetched = await getComboByName("test-combo");
    expect(fetched?.models).toEqual(["a", "b"]);
    const deleted = await deleteCombo(created.id);
    expect(deleted).toBe(true);
  });
});
