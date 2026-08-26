import { describe, expect, it } from "vitest";
import { extractModelMarketApiKey, sanitizeModelMarketLog } from "../../src/lib/auth/modelMarket.js";
import { findScopedModelMarketLog } from "../../src/app/api/model-market/logs/[id]/detail/route.js";

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
      routerSelectedProvider: "DeepSeek",
      provider: "test-provider",
      endpoint: "/v1/chat/completions",
      inputTokens: 10,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      cacheHitRate: 15.38,
      outputTokens: 5,
      cost: 0.01,
      status: "ok",
      ttftMs: 45,
      latencyMs: 123,
      logType: "success",
      apiKey: "secret-key",
      apiKeyName: "private name",
      account: "provider-account@example.com",
      requestBody: { secret: true },
      responseBody: { secret: true },
    });

    expect(sanitized).toMatchObject({
      id: 9,
      timestamp: "2026-08-24T00:00:00.000Z",
      model: "test-model",
      selectedModel: "test-model",
      selectedModelType: "模型",
      actualModel: "test-model",
      routerSelectedModel: "DeepSeek-V4-Pro",
      routerSelectedProvider: "DeepSeek",
      provider: "test-provider",
      endpoint: "/v1/chat/completions",
      inputTokens: 10,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      cacheHitRate: 15.38,
      outputTokens: 5,
      cost: 0.01,
      status: "ok",
      ttftMs: 45,
      latencyMs: 123,
      logType: "success",
    });
    expect(sanitized).not.toHaveProperty("apiKey");
    expect(sanitized).not.toHaveProperty("apiKeyName");
    expect(sanitized).not.toHaveProperty("account");
    expect(sanitized).not.toHaveProperty("requestBody");
    expect(sanitized).not.toHaveProperty("responseBody");
  });

  it("scopes error detail lookup to the authenticated API key", () => {
    const calls = [];
    const db = {
      get(sql, params) {
        calls.push({ sql, params });
        return { id: params[0] };
      },
    };

    expect(findScopedModelMarketLog(db, "log-9", "scoped-key")).toEqual({ id: "log-9" });
    expect(calls[0].sql).toContain("WHERE id = ? AND apiKey = ?");
    expect(calls[0].params).toEqual(["log-9", "scoped-key"]);
  });
});
