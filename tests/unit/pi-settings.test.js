import { describe, expect, it } from "vitest";
import { buildPiProvider } from "../../src/lib/piSettings.js";

const capabilities = (model) => ({
  contextWindow: model === "ag/large" ? 1048576 : 200000,
  maxOutput: model === "ag/large" ? 131072 : 32000,
});

describe("buildPiProvider", () => {
  it("preserves provider metadata and unselected models", () => {
    const provider = buildPiProvider({
      baseUrl: "http://localhost:20128/v1",
      apiKey: "existing-key",
      customField: "keep-me",
      models: [
        { id: "ag/large", name: "Large", contextWindow: 524288, maxTokens: 65536 },
        { id: "keep/me", name: "Keep", contextWindow: 64000, maxTokens: 8000 },
      ],
    }, { baseUrl: "http://localhost:20128", models: ["ag/large"] }, capabilities);

    expect(provider.customField).toBe("keep-me");
    expect(provider.apiKey).toBe("existing-key");
    expect(provider.models).toEqual([
      { id: "keep/me", name: "Keep", contextWindow: 64000, maxTokens: 8000 },
      { id: "ag/large", name: "Large", contextWindow: 524288, maxTokens: 65536 },
    ]);
  });

  it("uses gateway capabilities for a new plain model id", () => {
    const provider = buildPiProvider({}, { baseUrl: "http://localhost:20128", models: ["ag/large"] }, capabilities);

    expect(provider.models).toEqual([
      { id: "ag/large", name: "ag/large", contextWindow: 1048576, maxTokens: 131072 },
    ]);
  });

  it("accepts snake_case limits sent by the client", () => {
    const provider = buildPiProvider({}, {
      baseUrl: "http://localhost:20128",
      models: [{ id: "custom/model", context_window: 300000, max_tokens: 40000 }],
    }, capabilities);

    expect(provider.models[0]).toMatchObject({ contextWindow: 300000, maxTokens: 40000 });
  });
});
