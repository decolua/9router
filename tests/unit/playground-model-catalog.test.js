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

  it("excludes inactive connections and ignores connection objects without provider or id", () => {
    const catalog = normalizeModelCatalog({
      connections: [
        { id: "inactive", provider: "alpha", name: "Inactive", isActive: false },
        { id: "no-provider", name: "Unsafe", isActive: true },
        { provider: "beta", name: "Unsafe", isActive: true },
      ],
      staticModelsByProvider: { alpha: [{ id: "hidden" }] },
      liveModelsByConnection: {},
    });

    expect(catalog).toEqual([]);
  });

  it("keeps only explicitly allowed model and capability fields, ignoring redacted or unrelated connection fields", () => {
    const catalog = normalizeModelCatalog({
      connections: [{ 
        id: "connection-a", 
        provider: "alpha", 
        name: "Alpha", 
        isActive: true, 
        providerSpecificData: { something: "here" },
        accessToken: "some-redacted-or-undefined-value" 
      }],
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

  it("loads live models only from active connection endpoints when provider payloads omit models", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [
            { id: "c1", provider: "test1", name: "Test 1", isActive: true },
            { id: "c2", provider: "test2", name: "Test 2", isActive: false },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { id: "m1", capabilities: { reasoning: true, unsafe: true } },
            { id: "m2", name: "Model 2" },
          ],
        }),
      });

    const result = await fetchModelCatalog();

    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/providers", { cache: "no-store" });
    expect(global.fetch).toHaveBeenNthCalledWith(2, "/api/providers/c1/models", { cache: "no-store" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.models).toEqual([
      {
        id: "test1/m1",
        label: "m1",
        provider: { id: "test1", name: "Test 1", connectionId: "c1" },
        available: true,
        capabilities: { reasoning: true },
      },
      {
        id: "test1/m2",
        label: "Model 2",
        provider: { id: "test1", name: "Test 1", connectionId: "c1" },
        available: true,
        capabilities: {},
      },
    ]);
  });

  it("keeps models from successful connections when another connection model request fails", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [
            { id: "c1", provider: "test1", name: "Test 1", isActive: true },
            { id: "c2", provider: "test2", name: "Test 2", isActive: true },
          ],
        }),
      })
      .mockRejectedValueOnce(new Error("connection unavailable"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ id: "m2" }] }),
      });

    const result = await fetchModelCatalog();

    expect(global.fetch).toHaveBeenNthCalledWith(2, "/api/providers/c1/models", { cache: "no-store" });
    expect(global.fetch).toHaveBeenNthCalledWith(3, "/api/providers/c2/models", { cache: "no-store" });
    expect(result.models).toEqual([
      {
        id: "test2/m2",
        label: "m2",
        provider: { id: "test2", name: "Test 2", connectionId: "c2" },
        available: true,
        capabilities: {},
      },
    ]);
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
    
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [
            { id: "c1", provider: "test1", name: "Test 1", isActive: true },
            { id: "c2", provider: "test2", name: "Test 2", isActive: true },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: "bad" }),
      });
    await expect(fetchModelCatalog()).resolves.toEqual({ models: [] });
    expect(global.fetch).toHaveBeenNthCalledWith(3, "/api/providers", { cache: "no-store" });
    expect(global.fetch).toHaveBeenNthCalledWith(4, "/api/providers/c1/models", { cache: "no-store" });
    expect(global.fetch).toHaveBeenNthCalledWith(5, "/api/providers/c2/models", { cache: "no-store" });
  });

  it("handles fetch failure gracefully", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });
    await expect(fetchModelCatalog()).rejects.toThrow("Failed to load connections (status: 500)");
  });
});
