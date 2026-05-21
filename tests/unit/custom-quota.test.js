import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

describe("Enhanced/Custom Provider Usage & Quota Fetchers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  describe("OpenRouter Usage Fetcher", () => {
    it("handles valid API key response correctly", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              label: "My Key",
              limit: 10.5,
              usage: 2.1,
              is_free_tier: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getUsageForProvider({
        provider: "openrouter",
        apiKey: "sk-or-test-key",
      });

      expect(res.plan).toBe("OpenRouter");
      expect(res.label).toBe("My Key");
      expect(res.quotas.balance).toMatchObject({
        used: 2.1,
        total: 10.5,
        remaining: 8.4,
        unlimited: false,
        displayName: "Credits (USD)",
      });
      expect(res.quotas.balance.remainingPercentage).toBeCloseTo(80);
    });

    it("handles unlimited/free tier key response", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              label: "Free Key",
              limit: null,
              usage: 0.5,
              is_free_tier: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getUsageForProvider({
        provider: "openrouter",
        apiKey: "sk-or-test-key",
      });

      expect(res.plan).toBe("OpenRouter (Free)");
      expect(res.quotas.balance).toMatchObject({
        used: 0.5,
        total: 0,
        remaining: 0,
        unlimited: true,
      });
    });

    it("handles authentication error (401/403)", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid key" }), { status: 401 })
      );

      const res = await getUsageForProvider({
        provider: "openrouter",
        apiKey: "sk-or-invalid-key",
      });

      expect(res.message).toContain("invalid or expired");
    });
  });

  describe("Perplexity Web Session Status Fetcher", () => {
    it("handles active pro subscription", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              email: "user@example.com",
              subscription_status: "active",
              active_subscription: "pro",
            },
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "perplexity-web",
        apiKey: "perplexity-cookie-value",
      });

      expect(res.plan).toBe("Perplexity Pro (Active)");
      expect(res.quotas.subscription).toMatchObject({
        used: 0,
        total: 1,
        remaining: 1,
        unlimited: true,
      });
    });

    it("handles free subscription", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              email: "user@example.com",
              subscription_status: "free",
            },
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "perplexity-web",
        apiKey: "perplexity-cookie-value",
      });

      expect(res.plan).toBe("Perplexity Free");
      expect(res.quotas.subscription).toMatchObject({
        used: 1,
        total: 1,
        remaining: 0,
        unlimited: false,
      });
    });
  });

  describe("Grok Web Session Status Fetcher", () => {
    it("handles active grok session successfully", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "conv-123",
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "grok-web",
        apiKey: "grok-cookie-value",
      });

      expect(res.plan).toBe("Grok Web Premium");
      expect(res.quotas.session).toMatchObject({
        used: 0,
        total: 1,
        remaining: 1,
        unlimited: true,
      });
    });

    it("handles expired/invalid grok session", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response("", { status: 401 })
      );

      const res = await getUsageForProvider({
        provider: "grok-web",
        apiKey: "grok-cookie-value",
      });

      expect(res.message).toContain("auth failed");
    });
  });

  describe("Generic Custom Quota Fetcher", () => {
    it("correctly retrieves custom quota values using dot-notation and array indices", async () => {
      const mockPayload = {
        status: "success",
        account: {
          balance_infos: [
            { asset_type: "USD", amount: 150.75 },
            { asset_type: "EUR", amount: 50.00 },
          ],
          used_credits: 25.25,
          reset_date: "2026-06-01T00:00:00Z",
        },
      };

      proxyAwareFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPayload), { status: 200 })
      );

      const res = await getUsageForProvider({
        provider: "any-custom-provider",
        apiKey: "custom-token",
        providerSpecificData: {
          customQuotaUrl: "https://api.mycustomprovider.com/v1/quota",
          customQuotaJsonPathTotal: "account.balance_infos[0].amount",
          customQuotaJsonPathUsed: "account.used_credits",
          customQuotaJsonPathResetAt: "account.reset_date",
          customQuotaDisplayName: "Custom Credits (USD)",
        },
      });

      expect(res.plan).toBe("Custom Plan");
      expect(res.quotas.custom).toMatchObject({
        total: 150.75,
        used: 25.25,
        remaining: 125.5,
        unlimited: false,
        displayName: "Custom Credits (USD)",
      });
      expect(res.quotas.custom.resetAt).toBe("2026-06-01T00:00:00.000Z");
      expect(res.quotas.custom.remainingPercentage).toBeCloseTo(83.25);
    });

    it("handles fallback to remaining-only with unlimited status", async () => {
      const mockPayload = {
        remaining_calls: 500,
      };

      proxyAwareFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPayload), { status: 200 })
      );

      const res = await getUsageForProvider({
        provider: "any-custom-provider",
        providerSpecificData: {
          customQuotaUrl: "https://api.mycustomprovider.com/v1/quota",
          customQuotaJsonPathRemaining: "remaining_calls",
        },
      });

      expect(res.quotas.custom).toMatchObject({
        total: 500,
        used: 0,
        remaining: 500,
        unlimited: true,
      });
    });

    it("uses connection apiKey if customQuotaHeaders is not configured", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ val: 100 }), { status: 200 })
      );

      await getUsageForProvider({
        provider: "any-custom-provider",
        apiKey: "provided-api-key",
        providerSpecificData: {
          customQuotaUrl: "https://api.mycustomprovider.com/v1/quota",
          customQuotaJsonPathRemaining: "val",
        },
      });

      expect(proxyAwareFetch).toHaveBeenCalledWith(
        "https://api.mycustomprovider.com/v1/quota",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer provided-api-key",
          }),
        }),
        null
      );
    });
  });

  describe("Codex Usage 401 error mapping", () => {
    it("returns descriptive message on session expiry/unauthorized", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response("", { status: 401 })
      );

      const res = await getUsageForProvider({
        provider: "codex",
        accessToken: "expired-token",
      });

      expect(res.message).toContain("session expired or unauthorized");
    });
  });

  describe("CommandCode Usage Fetcher", () => {
    it("handles success response with flat credits format", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            plan: "Pro",
            total: 30.00,
            used: 12.50,
            remaining: 17.50,
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "commandcode",
        apiKey: "user-provided-key",
      });

      expect(res.plan).toBe("CommandCode Pro");
      expect(res.quotas.credits).toMatchObject({
        total: 30.00,
        used: 12.50,
        remaining: 17.50,
        unlimited: false,
        displayName: "Credits (USD)",
      });
      expect(res.quotas.credits.remainingPercentage).toBeCloseTo(58.33);
    });

    it("handles nested credits and user structure", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              plan: "Max",
              balance: {
                limit: 150.0,
                spent: 50.0,
              }
            }
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "commandcode",
        apiKey: "user-provided-key",
      });

      expect(res.plan).toBe("CommandCode Max");
      expect(res.quotas.credits).toMatchObject({
        total: 150.0,
        used: 50.0,
        remaining: 100.0,
        unlimited: false,
      });
    });

    it("falls back gracefully when billing endpoint returns non-standard JSON", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "active"
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "commandcode",
        apiKey: "user-provided-key",
      });

      expect(res.plan).toBe("CommandCode (CLI Key)");
      expect(res.quotas.credits.unlimited).toBe(true);
    });

    it("handles expired session (401/403)", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response("", { status: 401 })
      );

      const res = await getUsageForProvider({
        provider: "commandcode",
        apiKey: "user-provided-key",
      });

      expect(res.message).toContain("session invalid or expired");
    });

    it("returns correct error message when API key is not available", async () => {
      const res = await getUsageForProvider({
        provider: "commandcode",
      });

      expect(res.message).toContain("API key not available");
    });
  });

  describe("Ollama Cloud Usage Fetcher", () => {
    it("handles success response with standard tags models format", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { name: "llama3:latest", size: 4700000000 }
            ]
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "ollama",
        accessToken: "user-provided-ollama-key",
      });

      expect(res.plan).toBe("Ollama Cloud (Free)");
      expect(res.quotas.session).toMatchObject({
        used: 0,
        total: 1,
        remaining: 1,
        unlimited: true,
        displayName: "Connection Status"
      });
    });

    it("handles success response with custom plan and quota in JSON body", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              plan: "Pro",
              quota: {
                limit: 1000,
                used: 250
              }
            }
          }),
          { status: 200 }
        )
      );

      const res = await getUsageForProvider({
        provider: "ollama",
        accessToken: "user-provided-ollama-key",
      });

      expect(res.plan).toBe("Ollama Cloud (Pro)");
      expect(res.quotas.credits).toMatchObject({
        total: 1000,
        used: 250,
        remaining: 750,
        unlimited: false,
        displayName: "Quota"
      });
      expect(res.quotas.credits.remainingPercentage).toBeCloseTo(75);
    });

    it("handles success response with rate-limit headers", async () => {
      const headers = new Headers();
      headers.set("x-ratelimit-limit", "5000");
      headers.set("x-ratelimit-remaining", "4200");

      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({}),
          {
            status: 200,
            headers
          }
        )
      );

      const res = await getUsageForProvider({
        provider: "ollama",
        accessToken: "user-provided-ollama-key",
      });

      expect(res.quotas.rateLimit).toMatchObject({
        total: 5000,
        remaining: 4200,
        used: 800,
        unlimited: false,
        displayName: "Rate Limit (Requests)"
      });
      expect(res.quotas.rateLimit.remainingPercentage).toBeCloseTo(84);
    });

    it("handles expired session (401/403) gracefully", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response("", { status: 401 })
      );

      const res = await getUsageForProvider({
        provider: "ollama",
        accessToken: "expired-ollama-key",
      });

      expect(res.message).toContain("session invalid or expired");
    });

    it("returns correct error message when access token is not available", async () => {
      const res = await getUsageForProvider({
        provider: "ollama",
      });

      expect(res.message).toContain("API key not available");
    });
  });
});

