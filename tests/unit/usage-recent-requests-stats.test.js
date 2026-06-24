import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    all: vi.fn(),
  },
  getApiKeys: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => mocks.db),
}));

vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(async () => []),
}));

vi.mock("../../src/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("../../src/lib/db/repos/nodesRepo.js", () => ({
  getProviderNodes: vi.fn(async () => []),
}));

const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");

describe("usage stats recent request API key metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global._apiKeyMapCache.map = {};
    global._apiKeyMapCache.ts = 0;

    mocks.getApiKeys.mockResolvedValue([
      {
        id: "key-1",
        key: "sk-test-1234567890",
        name: "Agent CLI",
        createdAt: "2026-05-18T19:00:00.000Z",
      },
    ]);

    mocks.db.all.mockImplementation((sql) => {
      if (sql.includes("ORDER BY id DESC LIMIT 100")) {
        return [
          {
            timestamp: "2026-05-18T20:00:00.000Z",
            provider: "openai",
            model: "gpt-5",
            apiKey: "sk-test-1234567890",
            tokens: JSON.stringify({ prompt_tokens: 10, completion_tokens: 20 }),
            status: "ok",
          },
        ];
      }
      return [];
    });
  });

  it("includes API key display metadata in stats recent requests", async () => {
    const stats = await getUsageStats("24h");

    expect(stats.recentRequests).toEqual([
      expect.objectContaining({
        model: "gpt-5",
        provider: "openai",
        promptTokens: 10,
        completionTokens: 20,
        apiKeyId: "key-1",
        keyName: "Agent CLI",
      }),
    ]);
    // Security (#1258): the secret key must not leak into the recent-requests payload.
    expect(stats.recentRequests[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(stats.recentRequests)).not.toContain("sk-test-1234567890");
  });

  it("strips plaintext keys from the byApiKey aggregate while keeping known keys distinct", async () => {
    mocks.getApiKeys.mockResolvedValue([
      { id: "key-1", key: "sk-aaa-1111", name: "Agent CLI", createdAt: "2026-05-18T19:00:00.000Z" },
      { id: "key-2", key: "sk-bbb-2222", name: "Teammate", createdAt: "2026-05-18T19:00:00.000Z" },
    ]);
    // period "24h" builds byApiKey from the raw-rows path (usageRepo Z.609 query).
    mocks.db.all.mockImplementation((sql) => {
      if (sql.includes("promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp")) {
        return [
          { timestamp: "2026-05-18T20:00:00.000Z", provider: "openai", model: "gpt-5", apiKey: "sk-aaa-1111", tokens: JSON.stringify({ prompt_tokens: 10, completion_tokens: 20 }), cost: 0 },
          { timestamp: "2026-05-18T20:01:00.000Z", provider: "openai", model: "gpt-5", apiKey: "sk-aaa-1111", tokens: JSON.stringify({ prompt_tokens: 5, completion_tokens: 7 }), cost: 0 },
          { timestamp: "2026-05-18T20:02:00.000Z", provider: "openai", model: "gpt-5", apiKey: "sk-bbb-2222", tokens: JSON.stringify({ prompt_tokens: 3, completion_tokens: 4 }), cost: 0 },
        ];
      }
      return [];
    });

    const stats = await getUsageStats("24h");

    // No plaintext key anywhere in the aggregate — neither in values nor in the map keys.
    const serialized = JSON.stringify(stats.byApiKey);
    expect(serialized).not.toContain("sk-aaa-1111");
    expect(serialized).not.toContain("sk-bbb-2222");
    for (const k of Object.keys(stats.byApiKey)) {
      expect(k).not.toContain("sk-aaa-1111");
      expect(k).not.toContain("sk-bbb-2222");
    }

    // Two known keys stay distinct rows (keyed by non-secret id) with summed tokens.
    const rows = Object.values(stats.byApiKey);
    const agentCli = rows.find((r) => r.keyName === "Agent CLI");
    const teammate = rows.find((r) => r.keyName === "Teammate");
    expect(agentCli).toBeTruthy();
    expect(teammate).toBeTruthy();
    expect(agentCli.apiKeyId).toBe("key-1");
    expect(teammate.apiKeyId).toBe("key-2");
    expect(agentCli.requests).toBe(2);
    expect(agentCli.promptTokens).toBe(15);
    expect(agentCli.completionTokens).toBe(27);
    expect(teammate.requests).toBe(1);
    expect(agentCli).not.toHaveProperty("apiKey");
    expect(agentCli).not.toHaveProperty("apiKeyKey");
  });
});
