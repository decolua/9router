import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getCodeBuddyCnUsage } from "../../open-sse/services/usage/codebuddy-cn.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CodeBuddy CN usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes Chinese upstream package names for UI display", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: {
        Response: {
          Data: {
            Accounts: [
              {
                PackageName: "基础体验包",
                CycleStartTime: "2026-06-01T00:00:00+08:00",
                CycleEndTime: "2026-07-01T00:00:00+08:00",
                DeductionEndTime: Date.parse("2026-12-01T00:00:00+08:00"),
                CycleCapacityUsedPrecise: "12.5",
                CycleCapacitySizePrecise: "500",
              },
            ],
          },
        },
      },
    }));

    const usage = await getCodeBuddyCnUsage(null, "cn-key");

    expect(usage.plan).toBe("CodeBuddy CN");
    expect(usage.quotas.Monthly).toMatchObject({
      used: 12.5,
      total: 500,
      unlimited: false,
    });
  });
});
