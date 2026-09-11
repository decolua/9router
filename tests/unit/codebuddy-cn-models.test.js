import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockProxyAwareFetch = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mockProxyAwareFetch(...args),
}));

const mockRefreshCodebuddyToken = vi.fn();
vi.mock("open-sse/services/tokenRefresh/providers.js", () => ({
  refreshCodebuddyToken: (...args) => mockRefreshCodebuddyToken(...args),
}));

// Import after mocking
import {
  parseCodebuddyCnModels,
  resolveCodebuddyCnModels,
  clearCodebuddyCnModelCache,
} from "../../open-sse/services/codebuddyCnModels.js";

describe("CodeBuddy CN Model Resolver", () => {
  beforeEach(() => {
    mockProxyAwareFetch.mockReset();
    mockRefreshCodebuddyToken.mockReset();
    clearCodebuddyCnModelCache();
  });

  afterEach(() => {
    clearCodebuddyCnModelCache();
  });

  describe("parseCodebuddyCnModels", () => {
    it("extracts models permitted for cli agent and filters disabled models", () => {
      const sampleResponse = {
        code: 0,
        data: {
          agents: [
            {
              id: "web-chat",
              name: "web",
              models: ["deepseek-v3", "gpt-4o"],
            },
            {
              id: "cli-agent",
              name: "cli",
              models: ["deepseek-v3.1", "deepseek-v4.1-flash", "kimi-k2", "disabled-model"],
            },
          ],
          models: [
            { id: "deepseek-v3.1", name: "DeepSeek V3.1", disabled: false },
            { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", disabled: false },
            { id: "kimi-k2", name: "Kimi K2", disabled: false },
            { id: "disabled-model", name: "Disabled Model", disabled: true },
            { id: "gpt-4o", name: "GPT-4o (Web only)", disabled: false },
          ],
        },
      };

      const models = parseCodebuddyCnModels(sampleResponse);
      expect(models).toEqual([
        { id: "deepseek-v3.1", name: "DeepSeek V3.1" },
        { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
        { id: "kimi-k2", name: "Kimi K2" },
      ]);
      // gpt-4o is only in web agent, disabled-model is disabled: true
      expect(models.find((m) => m.id === "gpt-4o")).toBeUndefined();
      expect(models.find((m) => m.id === "disabled-model")).toBeUndefined();
    });

    it("falls back to all non-disabled models when no cli agent is present", () => {
      const sampleResponse = {
        code: 0,
        data: {
          agents: [],
          models: [
            { id: "model-a", name: "Model A", disabled: false },
            { id: "model-b", name: "Model B", disabled: true },
          ],
        },
      };

      const models = parseCodebuddyCnModels(sampleResponse);
      expect(models).toEqual([{ id: "model-a", name: "Model A" }]);
    });

    it("returns empty array gracefully on invalid data", () => {
      expect(parseCodebuddyCnModels(null)).toEqual([]);
      expect(parseCodebuddyCnModels({})).toEqual([]);
      expect(parseCodebuddyCnModels({ code: 1, msg: "failed" })).toEqual([]);
    });
  });

  describe("resolveCodebuddyCnModels", () => {
    it("successfully fetches models and caches response", async () => {
      const mockData = {
        code: 0,
        data: {
          agents: [{ name: "cli", models: ["deepseek-v3.1"] }],
          models: [{ id: "deepseek-v3.1", name: "DeepSeek V3.1", disabled: false }],
        },
      };

      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      const credentials = { accessToken: "test_token_123" };
      const res1 = await resolveCodebuddyCnModels(credentials);
      expect(res1.models).toEqual([{ id: "deepseek-v3.1", name: "DeepSeek V3.1" }]);
      expect(mockProxyAwareFetch).toHaveBeenCalledTimes(1);

      // Verify request headers
      const [calledUrl, calledOptions] = mockProxyAwareFetch.mock.calls[0];
      expect(calledUrl).toBe("https://copilot.tencent.com/console/enterprises/personal/models");
      expect(calledOptions.headers.Authorization).toBe("Bearer test_token_123");
      expect(calledOptions.headers.Origin).toBe("https://www.codebuddy.cn");
      expect(calledOptions.headers.Referer).toBe("https://www.codebuddy.cn/");

      // Second call should hit in-memory cache
      const res2 = await resolveCodebuddyCnModels(credentials);
      expect(res2.models).toEqual(res1.models);
      expect(mockProxyAwareFetch).toHaveBeenCalledTimes(1);

      // Call with forceRefresh should bypass cache
      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });
      const res3 = await resolveCodebuddyCnModels(credentials, { forceRefresh: true });
      expect(res3.models).toEqual(res1.models);
      expect(mockProxyAwareFetch).toHaveBeenCalledTimes(2);
    });

    it("handles 401 with transparent token refresh and retry", async () => {
      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      mockRefreshCodebuddyToken.mockResolvedValueOnce({
        accessToken: "new_refreshed_token",
        refreshToken: "new_refresh_token",
        expiresIn: 3600,
      });

      const mockData = {
        code: 0,
        data: {
          agents: [{ name: "cli", models: ["deepseek-v3.1"] }],
          models: [{ id: "deepseek-v3.1", name: "DeepSeek V3.1", disabled: false }],
        },
      };

      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      const onCredentialsRefreshed = vi.fn();
      const credentials = {
        accessToken: "expired_token",
        refreshToken: "valid_refresh_token",
      };

      const res = await resolveCodebuddyCnModels(credentials, { onCredentialsRefreshed });
      expect(res.models).toEqual([{ id: "deepseek-v3.1", name: "DeepSeek V3.1" }]);
      expect(mockRefreshCodebuddyToken).toHaveBeenCalledWith("valid_refresh_token", null);
      expect(onCredentialsRefreshed).toHaveBeenCalledWith({
        accessToken: "new_refreshed_token",
        refreshToken: "new_refresh_token",
        expiresIn: 3600,
      });

      // Second call to proxyAwareFetch should use new token
      expect(mockProxyAwareFetch).toHaveBeenCalledTimes(2);
      expect(mockProxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new_refreshed_token");
    });
  });
});
