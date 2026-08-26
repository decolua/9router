import { describe, expect, it } from "vitest";

import { normalizeModelCatalog } from "../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js";

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
