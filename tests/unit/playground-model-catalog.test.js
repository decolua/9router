import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { normalizeModelCatalog, fetchModelCatalog } from "../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js";

describe("normalizeModelCatalog", () => {
  it("normalizes, deduplicates, and sorts connected static and live models with capabilities", () => {
    const catalog = normalizeModelCatalog({
      connections: [
        {
          id: "connection-b",
          provider: "beta",
          name: "Beta",
          isActive: true,
        },
        { id: "connection-a", provider: "alpha", name: "Alpha", isActive: true },
      ],
      staticModelsByProvider: {
        alpha: [{ id: "zeta", name: "Zeta", capabilities: { vision: true, unknown: true } }],
        beta: [{ id: "beta-model", name: "Beta model" }],
      },
      liveModelsByConnection: {
        "connection-a": [{ id: "zeta", name: "Live Zeta", capabilities: { reasoning: true, maxOutput: 1024 } }],
        "connection-b": [{ id: "alpha-model", name: "Alpha model", capabilities: { seed: true } }],
      },
    });

    expect(catalog).toEqual([
      {
        id: "alpha/zeta",
        label: "Zeta",
        provider: { id: "alpha", name: "Alpha", connectionId: "connection-a" },
        available: true,
        capabilities: { vision: true, reasoning: true, maxOutput: 1024 },
      },
      {
        id: "beta/alpha-model",
        label: "Alpha model",
        provider: { id: "beta", name: "Beta", connectionId: "connection-b" },
        available: true,
        capabilities: { seed: true },
      },
      {
        id: "beta/beta-model",
        label: "Beta model",
        provider: { id: "beta", name: "Beta", connectionId: "connection-b" },
        available: true,
        capabilities: {},
      },
    ]);
  });

  it("excludes inactive connections and rejects discovery objects with credential-bearing fields", () => {
    const catalog = normalizeModelCatalog({
      connections: [
        { id: "inactive", provider: "alpha", name: "Inactive", isActive: false },
        {
          id: "unsafe",
          provider: "beta",
          name: "Unsafe",
          isActive: true,
          accessToken: "session-secret",
          headers: { Authorization: "Bearer sk-secret-value" },
        },
      ],
      staticModelsByProvider: { alpha: [{ id: "hidden" }], beta: [{ id: "unsafe" }] },
      liveModelsByConnection: {},
    });

    expect(catalog).toEqual([]);
    expect(JSON.stringify(catalog)).not.toContain("sk-secret-value");
    expect(JSON.stringify(catalog)).not.toContain("session-secret");
  });

  it("keeps only explicitly allowed model and capability fields", () => {
    const catalog = normalizeModelCatalog({
      connections: [{ id: "connection-a", provider: "alpha", name: "Alpha", isActive: true }],
      staticModelsByProvider: {},
      liveModelsByConnection: {
        "connection-a": [{
          id: "model",
          displayName: "Safe model",
          available: false,
          capabilities: { temperature: true, unknown: "discard" },
          providerSpecificData: { apiKey: "sk-secret-value" },
          url: "https://user:password@example.com",
          headers: { Authorization: "Bearer sk-secret-value" },
          customField: "discard",
        }],
      },
    });

    expect(catalog).toEqual([{
      id: "alpha/model",
      label: "Safe model",
      provider: { id: "alpha", name: "Alpha", connectionId: "connection-a" },
      available: false,
      capabilities: { temperature: true },
    }]);
    expect(JSON.stringify(catalog)).not.toMatch(/secret|password|headers|providerSpecificData|customField/i);
  });
});

describe("fetchModelCatalog", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it("extracts connections safely and normalizes models correctly", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        connections: [
          { id: "c1", provider: "test1", name: "Test 1", isActive: true, models: ["m1", { id: "m2", name: "Model 2" }] }
        ]
      })
    });

    const result = await fetchModelCatalog();
    expect(result.models.length).toBe(2);
    expect(result.models[0].id).toBe("test1/m1");
    expect(result.models[1].id).toBe("test1/m2");
    expect(result.models[1].label).toBe("Model 2");
  });

  it("handles malformed response shapes by returning empty models without crashing", async () => {
    // 1. Missing connections array
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { connections: [] } }) // malformed, API returns { connections: [] } at root
    });
    let result = await fetchModelCatalog();
    expect(result.models).toEqual([]);

    // 2. Connections is not an array
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ connections: "not-an-array" })
    });
    result = await fetchModelCatalog();
    expect(result.models).toEqual([]);
  });

  it("handles fetch failure gracefully", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });
    await expect(fetchModelCatalog()).rejects.toThrow("Failed to load connections (status: 500)");
  });
});
