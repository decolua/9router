import { describe, it, expect, vi, beforeEach } from "vitest";
import PROVIDER_REGISTRY from "open-sse/providers/registry/index.js";
import { USAGE_ROUTED_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const rows = [];
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({ all: () => rows }),
}));

const { getRoutedUsage } = await import("@/shared/services/routedUsage");

beforeEach(() => { rows.length = 0; });

/**
 * The fallback for a connection whose quota cannot be read from upstream.
 *
 * claude-cli normally reports its real subscription windows (claudeCliUsage.js
 * reads the same endpoint the claude provider does). What lands here is an
 * account with no credential to ask with — an expired local token, or a login
 * that never completed. The figures are then 9Router's own, and the contract
 * that matters is that they never masquerade as a limit.
 */
describe("routed usage", () => {
  it("counts the requests it routed for that connection", async () => {
    rows.push(
      { cost: 0.01, tokens: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5 }), status: "success" },
      { cost: 0.02, tokens: JSON.stringify({ prompt_tokens: 20, completion_tokens: 10 }), status: "success" },
    );
    const usage = await getRoutedUsage({ id: "c1", provider: "claude-cli" });
    expect(usage.quotas["routed 24h · requests"].used).toBe(2);
    expect(usage.quotas["routed 24h · tokens"].used).toBe(45);
  });

  it("never presents a figure as a quota with a limit", async () => {
    rows.push({ cost: 0, tokens: "{}", status: "success" });
    const usage = await getRoutedUsage({ id: "c1", provider: "claude-cli" });
    for (const [name, quota] of Object.entries(usage.quotas)) {
      expect(quota.unlimited, `${name} must not draw a progress bar`).toBe(true);
      expect(quota.remainingPercentage, `${name} must not claim a remaining %`).toBeNull();
      expect(quota.resetAt, `${name} must not claim a reset time`).toBeNull();
    }
  });

  it("says where the numbers came from", async () => {
    const usage = await getRoutedUsage({ id: "c1", provider: "claude-cli" });
    expect(usage.message).toMatch(/9Router/);
    expect(usage.message).toMatch(/reports no.*quota|remaining and reset are unknown/i);
    expect(usage.source).toBe("9router");
  });

  it("survives a malformed tokens column instead of losing the window", async () => {
    rows.push(
      { cost: 0, tokens: "not json", status: "success" },
      { cost: 0, tokens: JSON.stringify({ total: 7 }), status: "success" },
    );
    const usage = await getRoutedUsage({ id: "c1", provider: "claude-cli" });
    expect(usage.quotas["routed 24h · tokens"].used).toBe(7);
    expect(usage.quotas["routed 24h · requests"].used).toBe(2);
  });

  it("reports failures alongside the count", async () => {
    rows.push(
      { cost: 0, tokens: "{}", status: "success" },
      { cost: 0, tokens: "{}", status: "error" },
    );
    const usage = await getRoutedUsage({ id: "c1", provider: "claude-cli" });
    expect(usage.quotas["routed 24h · requests"].detail).toMatch(/1 failed/);
  });
});

describe("routed-usage provider registration", () => {
  it("covers exactly the providers whose credentials this server does not hold", () => {
    expect([...USAGE_ROUTED_PROVIDERS].sort()).toEqual(["claude-cli"]);
  });

  // The quota tracker's eligibility test is USAGE_SUPPORTED_PROVIDERS first, so
  // features.usage has to be set too or the routed flag never gets consulted.
  it("is also usage-supported, or the tracker filters it out first", () => {
    for (const id of USAGE_ROUTED_PROVIDERS) {
      expect(USAGE_SUPPORTED_PROVIDERS, `${id} missing from USAGE_SUPPORTED_PROVIDERS`).toContain(id);
    }
  });

  it("marks them in the registry rather than in a hand-kept list", () => {
    for (const id of ["claude-cli"]) {
      const entry = PROVIDER_REGISTRY.find((r) => r.id === id);
      expect(entry?.features?.usageRouted, `${id} features.usageRouted`).toBe(true);
    }
  });
});

/**
 * The API returning `unlimited: true` is only half the contract — the dashboard
 * re-parses every usage payload through parseQuotaData before the table sees
 * it, and its generic branch copied only name/used/total/resetAt. So the flag
 * was dropped on the way in and the table drew a full progress bar against a
 * limit nobody reported, which is exactly what these figures must never look
 * like.
 */
describe("routed figures survive the dashboard's own parser", () => {
  it("keeps unlimited, so no bar is drawn for a provider with no limit", async () => {
    const { parseQuotaData } = await import(
      "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils"
    );
    const parsed = parseQuotaData("claude-cli", {
      quotas: {
        "routed 24h · requests": {
          used: 3, unlimited: true, remaining: null, remainingPercentage: null,
          resetAt: null, detail: "3 requests",
        },
      },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].unlimited).toBe(true);
    expect(parsed[0].used).toBe(3);
    expect(parsed[0].detail).toBe("3 requests");
  });

  it("leaves a real quota's percentage alone", async () => {
    const { parseQuotaData } = await import(
      "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils"
    );
    const parsed = parseQuotaData("some-other-provider", {
      quotas: { "session (5h)": { used: 40, total: 100, remainingPercentage: 60, resetAt: null } },
    });
    expect(parsed[0].unlimited).toBeUndefined();
    expect(parsed[0].remainingPercentage).toBe(60);
  });
});

