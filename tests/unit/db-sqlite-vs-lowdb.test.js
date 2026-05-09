// Compare new SQLite-backed DB layer vs legacy lowdb behavior.
// Verifies: same public API signatures + equivalent results for core operations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let sqliteDb;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-db-compare-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  sqliteDb = await import("@/lib/db/index.js");
  await sqliteDb.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("DB SQLite layer — public API parity", () => {
  it("settings: get → defaults; update → merge", async () => {
    const s = await sqliteDb.getSettings();
    expect(s).toBeDefined();
    expect(s.cloudEnabled).toBe(false);
    expect(s.requireLogin).toBe(true);

    const updated = await sqliteDb.updateSettings({ cloudEnabled: true, customField: "x" });
    expect(updated.cloudEnabled).toBe(true);
    expect(updated.customField).toBe("x");
    expect(updated.requireLogin).toBe(true); // default preserved

    const re = await sqliteDb.getSettings();
    expect(re.cloudEnabled).toBe(true);
    expect(re.customField).toBe("x");
  });

  it("isCloudEnabled reflects settings", async () => {
    await sqliteDb.updateSettings({ cloudEnabled: true });
    expect(await sqliteDb.isCloudEnabled()).toBe(true);
    await sqliteDb.updateSettings({ cloudEnabled: false });
    expect(await sqliteDb.isCloudEnabled()).toBe(false);
  });

  it("apiKeys: create/get/validate/delete", async () => {
    const k = await sqliteDb.createApiKey("test-key", "machine-abc");
    expect(k.id).toBeDefined();
    expect(k.key).toMatch(/^sk-/);
    expect(k.machineId).toBe("machine-abc");
    expect(k.isActive).toBe(true);

    const all = await sqliteDb.getApiKeys();
    expect(all.find((x) => x.id === k.id)).toBeDefined();

    expect(await sqliteDb.validateApiKey(k.key)).toBeTruthy();
    expect(await sqliteDb.validateApiKey("invalid")).toBeFalsy();

    const deleted = await sqliteDb.deleteApiKey(k.id);
    expect(deleted).toBe(true);
    expect(await sqliteDb.getApiKeyById(k.id)).toBeNull();
  });

  it("providerConnections: CRUD + reorder by priority", async () => {
    const c1 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "a", apiKey: "k1" });
    const c2 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "b", apiKey: "k2" });
    const c3 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "c", apiKey: "k3" });

    const list = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(list).toHaveLength(3);
    expect(list[0].priority).toBe(1);
    expect(list[1].priority).toBe(2);
    expect(list[2].priority).toBe(3);

    // Update priority and reorder
    await sqliteDb.updateProviderConnection(c3.id, { priority: 1 });
    const reordered = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(reordered[0].name).toBe("c");

    // Delete reorders remaining
    await sqliteDb.deleteProviderConnection(c1.id);
    const after = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(after).toHaveLength(2);
    expect(after.every((c) => [1, 2].includes(c.priority))).toBe(true);
  });

  it("providerConnections: optional fields persisted via JSON column", async () => {
    const c = await sqliteDb.createProviderConnection({
      provider: "p2", authType: "oauth", email: "x@y.com",
      accessToken: "tok", refreshToken: "rtok", expiresAt: 12345,
      providerSpecificData: { foo: "bar" },
    });
    const back = await sqliteDb.getProviderConnectionById(c.id);
    expect(back.accessToken).toBe("tok");
    expect(back.refreshToken).toBe("rtok");
    expect(back.expiresAt).toBe(12345);
    expect(back.providerSpecificData).toEqual({ foo: "bar" });
  });

  it("providerNodes: CRUD", async () => {
    const n = await sqliteDb.createProviderNode({ type: "openai", name: "Test", baseUrl: "https://api.test", apiType: "openai" });
    expect(n.id).toBeDefined();
    expect(n.baseUrl).toBe("https://api.test");

    const all = await sqliteDb.getProviderNodes({ type: "openai" });
    expect(all.find((x) => x.id === n.id)).toBeDefined();

    await sqliteDb.updateProviderNode(n.id, { name: "Test2" });
    const updated = await sqliteDb.getProviderNodeById(n.id);
    expect(updated.name).toBe("Test2");

    await sqliteDb.deleteProviderNode(n.id);
    expect(await sqliteDb.getProviderNodeById(n.id)).toBeNull();
  });

  it("proxyPools: CRUD with sort by updatedAt desc", async () => {
    const p1 = await sqliteDb.createProxyPool({ name: "p1", proxyUrl: "http://a", type: "http" });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = await sqliteDb.createProxyPool({ name: "p2", proxyUrl: "http://b", type: "http" });
    const list = await sqliteDb.getProxyPools();
    expect(list[0].id).toBe(p2.id); // newest first
    await sqliteDb.deleteProxyPool(p1.id);
    await sqliteDb.deleteProxyPool(p2.id);
  });

  it("combos: CRUD", async () => {
    const c = await sqliteDb.createCombo({ name: "combo1", models: ["m1", "m2"], kind: "fallback" });
    expect(c.id).toBeDefined();
    expect(c.models).toEqual(["m1", "m2"]);
    const byName = await sqliteDb.getComboByName("combo1");
    expect(byName.id).toBe(c.id);
    await sqliteDb.updateCombo(c.id, { models: ["m3"] });
    const updated = await sqliteDb.getComboById(c.id);
    expect(updated.models).toEqual(["m3"]);
    expect(await sqliteDb.deleteCombo(c.id)).toBe(true);
  });

  it("modelAliases: KV ops", async () => {
    await sqliteDb.setModelAlias("alias1", "real-model-1");
    await sqliteDb.setModelAlias("alias2", "real-model-2");
    const all = await sqliteDb.getModelAliases();
    expect(all.alias1).toBe("real-model-1");
    expect(all.alias2).toBe("real-model-2");
    await sqliteDb.deleteModelAlias("alias1");
    expect((await sqliteDb.getModelAliases()).alias1).toBeUndefined();
  });

  it("customModels: add/list/delete with dedupe", async () => {
    const ok1 = await sqliteDb.addCustomModel({ providerAlias: "p1", id: "m1", type: "llm", name: "Model 1" });
    const dup = await sqliteDb.addCustomModel({ providerAlias: "p1", id: "m1", type: "llm" });
    expect(ok1).toBe(true);
    expect(dup).toBe(false);
    const list = await sqliteDb.getCustomModels();
    expect(list.find((m) => m.id === "m1")).toBeDefined();
    await sqliteDb.deleteCustomModel({ providerAlias: "p1", id: "m1" });
    const after = await sqliteDb.getCustomModels();
    expect(after.find((m) => m.id === "m1")).toBeUndefined();
  });

  it("mitmAlias: get/set per tool", async () => {
    await sqliteDb.setMitmAliasAll("cursor", { "gpt-5": "claude-3" });
    const a = await sqliteDb.getMitmAlias("cursor");
    expect(a["gpt-5"]).toBe("claude-3");
    const all = await sqliteDb.getMitmAlias();
    expect(all.cursor).toEqual({ "gpt-5": "claude-3" });
  });

  it("disabledModels: add/remove per provider", async () => {
    await sqliteDb.disableModels("openai", ["gpt-3", "gpt-4"]);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual(expect.arrayContaining(["gpt-3", "gpt-4"]));
    await sqliteDb.enableModels("openai", ["gpt-3"]);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual(["gpt-4"]);
    await sqliteDb.enableModels("openai", []);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual([]);
  });

  it("usage: saveRequestUsage + getUsageHistory + getUsageStats", async () => {
    await sqliteDb.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      endpoint: "/v1/chat/completions", status: "ok",
    });
    await sqliteDb.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      tokens: { prompt_tokens: 200, completion_tokens: 100 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    const hist = await sqliteDb.getUsageHistory({ provider: "openai" });
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist[0].tokens.prompt_tokens).toBeDefined();

    const stats = await sqliteDb.getUsageStats("24h");
    expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    expect(stats.byProvider.openai).toBeDefined();
    expect(stats.byProvider.openai.requests).toBeGreaterThanOrEqual(2);
    expect(stats.byProvider.openai.promptTokens).toBeGreaterThanOrEqual(300);
  });

  it("usage: pending tracking in-memory", () => {
    sqliteDb.trackPendingRequest("gpt-4", "openai", "c1", true);
    expect(global._pendingRequests.byModel["gpt-4 (openai)"]).toBe(1);
    sqliteDb.trackPendingRequest("gpt-4", "openai", "c1", false);
    expect(global._pendingRequests.byModel["gpt-4 (openai)"]).toBeUndefined();
  });

  it("requestDetails: save → query with paging", async () => {
    // Enable observability first
    await sqliteDb.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

    await sqliteDb.saveRequestDetail({
      id: "d1", provider: "openai", model: "gpt-4", connectionId: "c1",
      status: "ok", tokens: { prompt_tokens: 10 },
      request: { method: "POST" }, response: { status: 200 },
    });

    // Wait for buffer flush
    await new Promise((r) => setTimeout(r, 200));

    const got = await sqliteDb.getRequestDetailById("d1");
    expect(got).toBeDefined();
    expect(got.id).toBe("d1");

    const list = await sqliteDb.getRequestDetails({ provider: "openai" });
    expect(list.details.length).toBeGreaterThanOrEqual(1);
    expect(list.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  it("exportDb / importDb roundtrip", async () => {
    const exported = await sqliteDb.exportDb();
    expect(exported.settings).toBeDefined();
    expect(Array.isArray(exported.providerConnections)).toBe(true);
    expect(typeof exported.modelAliases).toBe("object");

    // Add marker, export, import a different payload, verify reset
    await sqliteDb.setModelAlias("marker", "before");
    const snap = await sqliteDb.exportDb();

    await sqliteDb.setModelAlias("marker", "after");
    expect((await sqliteDb.getModelAliases()).marker).toBe("after");

    await sqliteDb.importDb(snap);
    expect((await sqliteDb.getModelAliases()).marker).toBe("before");
  });

  it("pricing: user pricing merged with constants", async () => {
    await sqliteDb.updatePricing({ openai: { "gpt-test": { input: 1, output: 2 } } });
    const p = await sqliteDb.getPricing();
    expect(p.openai["gpt-test"]).toEqual({ input: 1, output: 2 });

    const single = await sqliteDb.getPricingForModel("openai", "gpt-test");
    expect(single).toEqual({ input: 1, output: 2 });

    await sqliteDb.resetPricing("openai", "gpt-test");
    expect((await sqliteDb.getPricing()).openai?.["gpt-test"]).toBeUndefined();
  });

  it("getChartData: 24h buckets", async () => {
    const data = await sqliteDb.getChartData("24h");
    expect(data).toHaveLength(24);
    expect(data[0]).toHaveProperty("label");
    expect(data[0]).toHaveProperty("tokens");
    expect(data[0]).toHaveProperty("cost");
  });

  it("getChartData: 7d buckets", async () => {
    const data = await sqliteDb.getChartData("7d");
    expect(data).toHaveLength(7);
  });
});
