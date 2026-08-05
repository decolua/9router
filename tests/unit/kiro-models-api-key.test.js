import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearKiroModelCache, resolveKiroModels } from "../../open-sse/services/kiroModels.js";

describe("Kiro API-key model discovery", () => {
  beforeEach(() => {
    clearKiroModelCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends API-key auth and preserves input/output limits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      models: [{
        modelId: "claude-opus-5",
        modelName: "Claude Opus 5",
        rateMultiplier: 2.2,
        tokenLimits: { maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true });

    expect(fetchMock.mock.calls[0][0]).toContain("q.us-west-2.amazonaws.com");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer kiro-api-key",
      TokenType: "API_KEY",
    });
    expect(result.models[0]).toMatchObject({
      id: "claude-opus-5",
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      rateMultiplier: 2.2,
    });
  });
});
