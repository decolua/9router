import { describe, expect, it } from "vitest";
import { extractModelMarketApiKey, sanitizeModelMarketLog } from "../../src/lib/auth/modelMarket.js";

describe("model market access boundary", () => {
  it("reads credentials from request headers without query-string fallback", () => {
    const bearerRequest = new Request("http://localhost/model-market?key=leaked", {
      headers: { Authorization: "Bearer scoped-key" },
    });
    const headerRequest = new Request("http://localhost/model-market?key=leaked", {
      headers: { "x-api-key": "header-key" },
    });
    const queryOnlyRequest = new Request("http://localhost/model-market?key=leaked");

    expect(extractModelMarketApiKey(bearerRequest)).toBe("scoped-key");
    expect(extractModelMarketApiKey(headerRequest)).toBe("header-key");
    expect(extractModelMarketApiKey(queryOnlyRequest)).toBe("");
  });

  it("removes connection, key and request-detail fields from public logs", () => {
    const sanitized = sanitizeModelMarketLog({
      id: 9,
      timestamp: "2026-08-24T00:00:00.000Z",
      model: "test-model",
      routerSelectedModel: "DeepSeek-V4-Pro",
      provider: "test-provider",
      endpoint: "/v1/chat/completions",
      inputTokens: 10,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      outputTokens: 5,
      cost: 0.01,
      status: "ok",
      latencyMs: 123,
      apiKey: "secret-key",
      apiKeyName: "private name",
      account: "provider-account@example.com",
      requestBody: { secret: true },
      responseBody: { secret: true },
    });

    expect(sanitized).toEqual({
      id: 9,
      timestamp: "2026-08-24T00:00:00.000Z",
      model: "test-model",
      routerSelectedModel: "DeepSeek-V4-Pro",
      provider: "test-provider",
      endpoint: "/v1/chat/completions",
      inputTokens: 10,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      outputTokens: 5,
      cost: 0.01,
      status: "ok",
      latencyMs: 123,
    });
  });
});
