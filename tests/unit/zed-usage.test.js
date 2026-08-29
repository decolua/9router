import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchZedAuthenticatedUser: vi.fn(),
  };
});

import { fetchZedAuthenticatedUser } from "../../open-sse/shared/zedAuth.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import {
  formatZedPlanLabel,
  parseZedUsageLimit,
  parseZedAuthenticatedUserUsage,
} from "../../open-sse/services/usage/zed.js";

describe("zed registry usage flags", () => {
  it("is listed in USAGE_SUPPORTED_PROVIDERS", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("zed");
  });
});

describe("parseZedUsageLimit", () => {
  it("parses unlimited string and object forms", () => {
    expect(parseZedUsageLimit("unlimited")).toEqual({ unlimited: true, total: 0 });
    expect(parseZedUsageLimit({ unlimited: true })).toEqual({ unlimited: true, total: 0 });
  });

  it("parses numeric and limited object forms", () => {
    expect(parseZedUsageLimit(50)).toEqual({ unlimited: false, total: 50 });
    expect(parseZedUsageLimit("25")).toEqual({ unlimited: false, total: 25 });
    expect(parseZedUsageLimit({ limited: 40 })).toEqual({ unlimited: false, total: 40 });
  });
});

describe("formatZedPlanLabel", () => {
  it("maps known plan ids", () => {
    expect(formatZedPlanLabel("zed_pro")).toBe("Zed Pro");
    expect(formatZedPlanLabel("zed_pro_trial")).toBe("Zed Pro Trial");
  });
});

describe("parseZedAuthenticatedUserUsage", () => {
  it("maps edit_predictions and billing cycle reset", () => {
    const parsed = parseZedAuthenticatedUserUsage({
      plan: {
        plan_v3: "zed_pro",
        subscription_period: {
          started_at: "2026-07-01T00:00:00Z",
          ended_at: "2026-08-01T00:00:00Z",
        },
        usage: {
          edit_predictions: { used: 12, limit: 50 },
        },
      },
    });

    expect(parsed.plan).toBe("Zed Pro");
    expect(parsed.quotas["Edit Predictions"]).toMatchObject({
      used: 12,
      total: 50,
      remainingPercentage: 76,
      resetAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("marks unlimited edit predictions at 100% remaining", () => {
    const parsed = parseZedAuthenticatedUserUsage({
      plan: {
        plan_v3: "zed_pro",
        usage: {
          edit_predictions: { used: 999, limit: "unlimited" },
        },
      },
    });

    expect(parsed.quotas["Edit Predictions"]).toMatchObject({
      used: 999,
      total: 0,
      remainingPercentage: 100,
      unlimited: true,
    });
  });

  it("skips token-billed model_requests limit=0 and adds billing note", () => {
    const parsed = parseZedAuthenticatedUserUsage({
      plan: {
        plan_v3: "zed_student",
        usage: {
          model_requests: { used: 0, limit: { limited: 0 } },
          edit_predictions: { used: 0, limit: "unlimited" },
        },
      },
    });

    expect(parsed.quotas["Hosted Model Requests"]).toBeUndefined();
    expect(parsed.quotas["Edit Predictions"]).toBeDefined();
    expect(parsed.message).toMatch(/token/i);
    expect(parsed.message).toMatch(/dashboard\.zed\.dev/);
  });

  it("surfaces overdue invoice warning", () => {
    const parsed = parseZedAuthenticatedUserUsage({
      plan: {
        plan_v3: "zed_pro",
        has_overdue_invoices: true,
        usage: {
          edit_predictions: { used: 0, limit: "unlimited" },
        },
      },
    });

    expect(parsed.hasOverdueInvoices).toBe(true);
    expect(parsed.message).toMatch(/overdue invoices/i);
  });
});

describe("getUsageForProvider(zed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns quotas from /client/users/me", async () => {
    fetchZedAuthenticatedUser.mockResolvedValueOnce({
      plan: {
        plan_v3: "zed_student",
        usage: {
          edit_predictions: { used: 3, limit: 30 },
        },
      },
    });

    const usage = await getUsageForProvider({
      provider: "zed",
      accessToken: "plain-token",
      providerSpecificData: { userId: "user-42", systemId: "sys-1" },
    });

    expect(usage.plan).toBe("Zed Student");
    expect(usage.quotas["Edit Predictions"]).toMatchObject({
      used: 3,
      total: 30,
      remainingPercentage: 90,
    });

    expect(fetchZedAuthenticatedUser).toHaveBeenCalledWith(
      {
        accessToken: "plain-token",
        providerSpecificData: { userId: "user-42", systemId: "sys-1" },
      },
      { proxyOptions: null },
    );
  });

  it("requires user id on the connection", async () => {
    const usage = await getUsageForProvider({
      provider: "zed",
      accessToken: "plain-token",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/missing user id/i);
    expect(fetchZedAuthenticatedUser).not.toHaveBeenCalled();
  });
});

describe("parseQuotaData(zed)", () => {
  it("normalizes zed quotas for QuotaTable", () => {
    const data = parseZedAuthenticatedUserUsage({
      plan: {
        plan_v3: "zed_pro",
        usage: { edit_predictions: { used: 10, limit: 20 } },
      },
    });

    const rows = parseQuotaData("zed", data);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Edit Predictions",
      used: 10,
      total: 20,
      remainingPercentage: 50,
    });
  });
});
