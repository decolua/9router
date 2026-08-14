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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("usage registry flags", () => {
  it("includes opencode-go and commandcode in usage-supported apikey providers", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("commandcode");
    expect(USAGE_APIKEY_PROVIDERS).toContain("commandcode");
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("glm");
    expect(USAGE_APIKEY_PROVIDERS).toContain("glm");
  });
});

describe("GLM usage parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses CREDIT_LIMIT quotas from GLM usage response", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 200,
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              percentage: 100,
              nextResetTime: 1786749523649,
            },
            {
              type: "CREDIT_LIMIT",
              unit: 6,
              number: 1,
              percentage: 20,
              nextResetTime: 1787336073998,
            },
          ],
          level: "lite",
        },
      })
    );

    const usage = await getUsageForProvider({
      provider: "glm",
      apiKey: "glm-key",
    });

    expect(usage.plan).toBe("Lite");
    expect(usage.quotas["5-Hour Limit"]).toBeDefined();
    expect(usage.quotas["5-Hour Limit"].used).toBe(100);
    expect(usage.quotas["Monthly Limit"]).toBeDefined();
    expect(usage.quotas["Monthly Limit"].used).toBe(20);

    const parsed = parseQuotaData("glm", usage);
    expect(parsed.length).toBe(2);
    expect(parsed[0].name).toBe("5-Hour Limit");
    expect(parsed[1].name).toBe("Monthly Limit");
  });
});

describe("OpenCode Go usage parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches and parses OpenCode Go rolling and monthly limits", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 15, resetsAt: "2026-08-15T02:08:13.245Z" },
          weekly: { status: "ok", percent: 40, resetsAt: "2026-08-17T00:00:00.245Z" },
          monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-26T09:20:20.245Z" },
        },
      })
    );

    const usage = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "ocg-key",
    });

    expect(usage.plan).toBe("OpenCode Go");
    expect(usage.quotas["Rolling (5h)"].used).toBe(15);
    expect(usage.quotas["Weekly"].used).toBe(40);
    expect(usage.quotas["Monthly"].used).toBe(100);

    const parsed = parseQuotaData("opencode-go", usage);
    expect(parsed.length).toBe(3);
    expect(parsed.find((q) => q.name === "Monthly").used).toBe(100);
  });
});

describe("Command Code usage parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches and parses Command Code 5-hour and weekly limits", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        windowLimits: {
          limited: true,
          fiveHour: { used: 5, cap: 14, resetAt: 0 },
          weekly: { used: 35, cap: 35, resetAt: 1786821078664 },
        },
      })
    );

    const usage = await getUsageForProvider({
      provider: "commandcode",
      apiKey: "user_xxx",
    });

    expect(usage.plan).toBe("Command Code");
    expect(usage.quotas["Session (5h)"].used).toBe(5);
    expect(usage.quotas["Weekly"].used).toBe(35);
    expect(usage.quotas["Weekly"].remainingPercentage).toBe(0);

    const parsed = parseQuotaData("commandcode", usage);
    expect(parsed.length).toBe(2);
  });
});
