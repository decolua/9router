import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const BASE = "https://api.commandcode.ai";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WHOAMI = {
  user: { name: "Hieu", email: "hieu@example.com" },
  org: { id: "org_1", name: "personal" },
};
const CREDITS = {
  credits: { monthlyCredits: 12.5, purchasedCredits: 1, freeCredits: 0.5 },
  windowLimits: {
    fiveHour: { used: 2, cap: 10, resetAt: Date.now() + 3_600_000, exceeded: false },
    weekly: { used: 20, cap: 70, resetAt: Date.now() + 86_400_000, exceeded: false },
  },
};
const SUBS = {
  data: {
    planId: "individual-goat",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  },
};

function mockHappyPath() {
  proxyAwareFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("/alpha/whoami")) return jsonResponse(WHOAMI);
    if (u.includes("/alpha/billing/credits")) return jsonResponse(CREDITS);
    if (u.includes("/alpha/billing/subscriptions")) return jsonResponse(SUBS);
    return jsonResponse({ error: "unexpected " + u }, 404);
  });
}

function mockGoPlanPath() {
  proxyAwareFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("/alpha/whoami")) return jsonResponse(WHOAMI);
    if (u.includes("/alpha/billing/credits")) {
      return jsonResponse({
        credits: { monthlyCredits: 6.39, purchasedCredits: 0, freeCredits: 0 },
      });
    }
    if (u.includes("/alpha/billing/subscriptions")) {
      return jsonResponse({
        data: {
          planId: "go",
          currentPeriodEnd: "2026-10-29T00:00:00.000Z",
        },
      });
    }
    return jsonResponse({ error: "unexpected " + u }, 404);
  });
}

describe("commandcode registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("commandcode");
    expect(USAGE_APIKEY_PROVIDERS).toContain("commandcode");
  });
});

describe("getUsageForProvider(commandcode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a message when apiKey is missing", async () => {
    const usage = await getUsageForProvider({ provider: "commandcode" });
    expect(usage.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("GETs whoami, credits, and subscriptions with Bearer apiKey", async () => {
    mockHappyPath();
    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "user_test",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("GOAT");
    const urls = proxyAwareFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.startsWith(`${BASE}/alpha/whoami`))).toBe(true);
    expect(urls.some((u) => u.includes("/alpha/billing/credits") && u.includes("orgId=org_1"))).toBe(true);
    expect(urls.some((u) => u.includes("/alpha/billing/subscriptions") && u.includes("orgId=org_1"))).toBe(true);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer user_test");
    expect(proxyAwareFetch.mock.calls[0][1].headers["x-command-code-version"]).toBe("1.88.0");
    expect(proxyAwareFetch.mock.calls[0][1].headers["User-Agent"]).toBe("cli");
  });

  it("maps remaining credits vs plan cap and rate windows", async () => {
    mockHappyPath();
    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "user_test",
    });

    // remaining = 12.5 + 1 + 0.5 = 14; cap GOAT = 70; used = 56
    expect(usage.quotas.Credits).toMatchObject({
      used: 56,
      total: 70,
      percentage: 80,
      unlimited: false,
    });
    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 2,
      total: 10,
      percentage: 20,
      unlimited: false,
    });
    expect(usage.quotas.Weekly).toMatchObject({
      used: 20,
      total: 70,
      percentage: 29,
    });
    expect(new Date(usage.quotas.Credits.resetAt).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("recognizes the API's short Go plan id", async () => {
    mockGoPlanPath();
    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "user_test",
    });

    expect(usage.plan).toBe("Go");
    expect(usage.quotas.Credits).toMatchObject({
      total: 10,
      remaining: 6.39,
      unlimited: false,
    });
    expect(usage.quotas.Credits.used).toBeCloseTo(3.61, 10);
  });

  it("recognizes the API's individual Go v1 plan id", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/alpha/whoami")) return jsonResponse({ user: {}, org: null });
      if (u.includes("/alpha/billing/credits")) {
        return jsonResponse({
          credits: { monthlyCredits: 6.389691728, purchasedCredits: 0, freeCredits: 0 },
          windowLimits: {
            fiveHour: { used: 0, cap: 3, resetAt: 0 },
            weekly: { used: 2.296017498, cap: 6, resetAt: 1792683377745 },
          },
        });
      }
      if (u.includes("/alpha/billing/subscriptions")) {
        return jsonResponse({
          data: { planId: "individual-go-v1", currentPeriodEnd: "2026-10-29T07:18:18.000Z" },
        });
      }
      return jsonResponse({}, 404);
    });

    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "user_test",
    });

    expect(usage.plan).toBe("Go");
    expect(usage.quotas.Credits).toMatchObject({
      total: 10,
      percentage: 36,
      remaining: 6.389691728,
      unlimited: false,
    });
    expect(usage.quotas.Credits.used).toBeCloseTo(3.610308272, 10);
    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 0,
      total: 3,
      percentage: 0,
      emptyMessage: "No usage in this window",
    });
    expect(usage.quotas.Weekly).toMatchObject({
      used: 2.296017498,
      total: 6,
      percentage: 38,
    });
  });

  it("returns an auth message on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "bad",
    });
    expect(usage.message).toMatch(/auth|key|login/i);
  });
});

describe("parseQuotaData(commandcode)", () => {
  it("forwards used/total/resetAt for the dashboard table", () => {
    const rows = parseQuotaData("commandcode", {
      plan: "GOAT",
      quotas: {
        Credits: { used: 56, total: 70, resetAt: "2026-10-01T00:00:00.000Z" },
        "Session (5h)": { used: 2, total: 10, resetAt: "2026-09-16T10:00:00.000Z" },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Credits", used: 56, total: 70 });
    expect(rows[1]).toMatchObject({ name: "Session (5h)", used: 2, total: 10 });
  });
});
