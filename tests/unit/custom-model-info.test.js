import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCustomModels: vi.fn(), getProviderConnections: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getCustomModels: mocks.getCustomModels,
  getProviderConnections: mocks.getProviderConnections,
}));

const { GET } = await import("../../src/app/api/v1/models/info/route.js");

describe("custom model info metadata", () => {
  beforeEach(() => {
    mocks.getCustomModels.mockReset();
    mocks.getProviderConnections.mockReset().mockResolvedValue([]);
  });

  it("returns provider-owned custom limits", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "provider-a", id: "shared", type: "llm", caps: { contextWindow: 123456, maxOutput: 7890 } },
      { providerAlias: "provider-b", id: "shared", type: "llm", caps: { contextWindow: 999999, maxOutput: 99999 } },
    ]);

    const response = await GET(new Request("https://router.test/v1/models/info?id=provider-a/shared"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "provider-a/shared",
      contextWindow: 123456,
      context_length: 123456,
      max_input_tokens: 123456,
      max_output_tokens: 7890,
      max_completion_tokens: 7890,
      capabilities: { contextWindow: 123456, maxOutput: 7890 },
    });
  });

  it("does not invent limits for an unknown custom model", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "provider-a", id: "unknown-custom", type: "llm" },
    ]);

    const response = await GET(new Request("https://router.test/v1/models/info?id=provider-a/unknown-custom"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("context_length");
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.capabilities).not.toHaveProperty("contextWindow");
    expect(body.capabilities).not.toHaveProperty("maxOutput");
  });

  it("resolves a configured prefix while retaining provider-id storage", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      provider: "openai-compatible-node-1",
      providerSpecificData: { prefix: "qa-limits" },
    }]);
    mocks.getCustomModels.mockResolvedValue([{
      providerAlias: "openai-compatible-node-1",
      id: "shared",
      type: "llm",
      caps: { contextWindow: 262144, maxOutput: 16384 },
    }]);

    const response = await GET(new Request("https://router.test/v1/models/info?id=qa-limits/shared"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "qa-limits/shared",
      context_length: 262144,
      max_completion_tokens: 16384,
    });
  });
});
