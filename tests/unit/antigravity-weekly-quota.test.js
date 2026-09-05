import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseResetTime } from "../../open-sse/services/usage/shared.js";

const { proxyAwareFetch } = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity Weekly Quota Parser & Fetcher", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  describe("Parser: parseAntigravityWeeklyQuotas", () => {
    it("TEST A — parses real top-level groups envelope with Gemini and Claude/GPT weekly buckets", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const realFixture = {
        description: "Sanitized quota summary",
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              {
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0.98583066,
                resetTime: "2026-09-10T15:50:40Z",
                disabled: false,
              },
              {
                bucketId: "gemini-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 0.9149841,
                resetTime: "2026-09-03T21:10:50Z",
                disabled: false,
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
            buckets: [
              {
                bucketId: "3p-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0,
                resetTime: "2026-09-06T17:02:34Z",
                disabled: false,
              },
              {
                bucketId: "3p-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 1,
                disabled: true,
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(realFixture);

      // Must produce gemini_weekly and claude_gpt_weekly
      expect(result).toHaveProperty("gemini_weekly");
      expect(result).toHaveProperty("claude_gpt_weekly");

      // Must NOT produce 5h buckets as new quota keys
      expect(result).not.toHaveProperty("gemini-5h");
      expect(result).not.toHaveProperty("3p-5h");
      expect(result).not.toHaveProperty("gemini_5h");
      expect(result).not.toHaveProperty("claude_gpt_5h");

      // Gemini Weekly checks
      expect(result.gemini_weekly).toMatchObject({
        displayName: "Gemini Weekly",
        total: 100,
        used: 1,
        unlimited: false,
      });
      expect(result.gemini_weekly.remainingPercentage).toBeCloseTo(98.583066, 4);
      expect(result.gemini_weekly.resetAt).toBe(parseResetTime("2026-09-10T15:50:40Z"));

      // Claude & GPT Weekly checks
      expect(result.claude_gpt_weekly).toMatchObject({
        displayName: "Claude & GPT Weekly",
        total: 100,
        used: 100,
        remainingPercentage: 0,
        unlimited: false,
      });
      expect(result.claude_gpt_weekly.resetAt).toBe(parseResetTime("2026-09-06T17:02:34Z"));
    });

    it("TEST B — explicit window discriminator wins even with unusual bucketId/displayName", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                bucketId: "bucket-tier-alpha",
                displayName: "Quota Pool Primary",
                window: "weekly",
                remainingFraction: 0.75,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.displayName).toBe("Gemini Weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(75);
      expect(result.gemini_weekly.used).toBe(25);
      expect(result.gemini_weekly.total).toBe(100);
    });

    it("TEST C — compatibility fallback when window field is absent", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixtureWithoutWindow = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                bucketId: "gemini-weekly-bucket",
                displayName: "Remaining allowance",
                remainingFraction: 0.5,
                resetTime: "2026-09-10T00:00:00Z",
              },
              {
                bucketId: "gemini-session-bucket",
                displayName: "Session allowance",
                remainingFraction: 0.9,
                resetTime: "2026-09-03T20:00:00Z",
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                bucketId: "pool-3p",
                displayName: "Weekly Allocation",
                remainingFraction: 0.4,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixtureWithoutWindow);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(50);
      expect(result.gemini_weekly.used).toBe(50);
      expect(result).toHaveProperty("claude_gpt_weekly");
      expect(result.claude_gpt_weekly.remainingPercentage).toBe(40);
      expect(result.claude_gpt_weekly.used).toBe(60);
    });

    it("TEST D — parses alternate envelope { quotaSummary: { groups: [...] } }", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const alternateEnvelope = {
        quotaSummary: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.8,
                  resetTime: "2026-09-10T00:00:00Z",
                },
              ],
            },
          ],
        },
      };

      const result = parseAntigravityWeeklyQuotas(alternateEnvelope);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(80);
    });

    it("TEST E — handles missing third-party group gracefully", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const onlyGemini = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.6,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(onlyGemini);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result).not.toHaveProperty("claude_gpt_weekly");
    });

    it("TEST F — handles missing Gemini group gracefully", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const onlyClaude = {
        groups: [
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.2,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(onlyClaude);
      expect(result).toHaveProperty("claude_gpt_weekly");
      expect(result).not.toHaveProperty("gemini_weekly");
    });

    it("TEST G — skips disabled weekly bucket but preserves weekly when sibling 5h is disabled", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      // Case 1: weekly bucket itself is disabled
      const weeklyDisabled = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.5,
                disabled: true,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };
      expect(parseAntigravityWeeklyQuotas(weeklyDisabled)).toEqual({});

      // Case 2: 5h sibling is disabled, weekly is NOT disabled (real live scenario)
      const siblingDisabled = {
        groups: [
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0,
                disabled: false,
                resetTime: "2026-09-06T17:02:34Z",
              },
              {
                window: "5h",
                remainingFraction: 1,
                disabled: true,
                resetTime: "2026-09-03T21:30:12Z",
              },
            ],
          },
        ],
      };
      const res = parseAntigravityWeeklyQuotas(siblingDisabled);
      expect(res).toHaveProperty("claude_gpt_weekly");
      expect(res.claude_gpt_weekly.used).toBe(100);
      expect(res.claude_gpt_weekly.remainingPercentage).toBe(0);
    });

    it("TEST H — handles malformed or unexpected input safely without throwing", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      expect(parseAntigravityWeeklyQuotas(null)).toEqual({});
      expect(parseAntigravityWeeklyQuotas(undefined)).toEqual({});
      expect(parseAntigravityWeeklyQuotas({})).toEqual({});
      expect(parseAntigravityWeeklyQuotas("string")).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: null })).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: [] })).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: [{}] })).toEqual({});
      expect(
        parseAntigravityWeeklyQuotas({
          groups: [
            {
              displayName: "Unknown Family Group",
              buckets: [{ window: "weekly", remainingFraction: 0.5 }],
            },
          ],
        })
      ).toEqual({});
      expect(
        parseAntigravityWeeklyQuotas({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [{ window: "weekly" }], // missing remainingFraction
            },
          ],
        })
      ).toEqual({});
    });

    it("TEST I — safely clamps fraction boundaries into 0..1", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 1.5, // > 1
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: -0.2, // < 0
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result.gemini_weekly.remainingPercentage).toBe(100);
      expect(result.gemini_weekly.used).toBe(0);
      expect(result.gemini_weekly.total).toBe(100);

      expect(result.claude_gpt_weekly.remainingPercentage).toBe(0);
      expect(result.claude_gpt_weekly.used).toBe(100);
      expect(result.claude_gpt_weekly.total).toBe(100);
    });

    it("TEST J — uses parseResetTime semantics for reset timestamps", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const timestamp = "2026-09-10T15:50:40Z";
      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.5,
                resetTime: timestamp,
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result.gemini_weekly.resetAt).toBe(parseResetTime(timestamp));
    });
  });

  describe("Fetcher: fetchAndParseAntigravityWeeklyQuotas", () => {
    it("TEST K1 — missing inputs return {} immediately", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      expect(await fetchAndParseAntigravityWeeklyQuotas(null, "p1")).toEqual({});
      expect(await fetchAndParseAntigravityWeeklyQuotas("tok", null)).toEqual({});
      expect(await fetchAndParseAntigravityWeeklyQuotas("", "")).toEqual({});
      expect(proxyAwareFetch).not.toHaveBeenCalled();
    });

    it("TEST K2 — upstream 404/429/500 fails open and returns {}", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const res404 = await fetchAndParseAntigravityWeeklyQuotas("tok-404", "proj-404", null, { force: true });
      expect(res404).toEqual({});

      proxyAwareFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const res429 = await fetchAndParseAntigravityWeeklyQuotas("tok-429", "proj-429", null, { force: true });
      expect(res429).toEqual({});
    });

    it("TEST K3 — network exception / timeout fails open and returns {}", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));

      const res = await fetchAndParseAntigravityWeeklyQuotas("tok-err", "proj-err", null, { force: true });
      expect(res).toEqual({});
    });

    it("TEST K4 — successful RPC response parses and caches correctly", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.95,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      const res = await fetchAndParseAntigravityWeeklyQuotas("tok-cache-test", "proj-cache-test");
      expect(res).toHaveProperty("gemini_weekly");
      expect(res.gemini_weekly.remainingPercentage).toBe(95);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // Second call should return from cache without additional network request
      const cachedRes = await fetchAndParseAntigravityWeeklyQuotas("tok-cache-test", "proj-cache-test");
      expect(cachedRes).toHaveProperty("gemini_weekly");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    });

    it("TEST K5 — cache key uses sha256 hash of token without raw token leakage or prefix collision", async () => {
      const { getWeeklyCacheKey } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const tokenA = "dummy-token-sameprefix-AAAAA";
      const tokenB = "dummy-token-sameprefix-BBBBB";

      const keyA = getWeeklyCacheKey("proj-1", tokenA);
      const keyB = getWeeklyCacheKey("proj-1", tokenB);

      expect(keyA).not.toBe(keyB);
      expect(keyA.startsWith("proj-1:")).toBe(true);
      expect(keyA).not.toContain("ya29.");
      expect(keyA).not.toContain("sameprefix");
    });

    it("TEST K6 — options.force bypasses cached quotas and performs live fetch", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas, _resetWeeklyQuotaCacheForTesting } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );
      _resetWeeklyQuotaCacheForTesting();

      proxyAwareFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.90,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      // 1. Initial call populates cache
      const res1 = await fetchAndParseAntigravityWeeklyQuotas("tok-force", "proj-force");
      expect(res1.gemini_weekly.remainingPercentage).toBe(90);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // 2. Call with force: true bypasses cache
      const res2 = await fetchAndParseAntigravityWeeklyQuotas("tok-force", "proj-force", null, { force: true });
      expect(res2.gemini_weekly.remainingPercentage).toBe(90);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    });

    it("TEST K7 — exhausted weekly quotas (0% remaining) are evicted and not cached", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas, _resetWeeklyQuotaCacheForTesting } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );
      _resetWeeklyQuotaCacheForTesting();

      proxyAwareFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      // 1. Call with exhausted quota
      const res1 = await fetchAndParseAntigravityWeeklyQuotas("tok-zero", "proj-zero");
      expect(res1.gemini_weekly.remainingPercentage).toBe(0);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // 2. Subsequent call must NOT be served from a stale 60s cache
      const res2 = await fetchAndParseAntigravityWeeklyQuotas("tok-zero", "proj-zero");
      expect(res2.gemini_weekly.remainingPercentage).toBe(0);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    });
  });
});
