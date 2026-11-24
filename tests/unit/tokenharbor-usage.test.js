import { describe, it, expect, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

describe("Token Harbor usage", () => {
  it("maps /api/cli/free-tier to Pass + free rows", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({
      plan_name: "Office Pass", on_plan: true, plan_used_pct: 37, plan_exhausted: false,
      used_pct: 12, exhausted: false, reset_at: "2026-11-12T09:12:44.512+00:00", models_enabled: true,
    }));
    const usage = await getUsageForProvider({ provider: "tokenharbor", authType: "apikey", apiKey: "k" });
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://tokenharbor.ai/api/cli/free-tier");
    expect(usage.plan).toBe("Office Pass");
    expect(usage.quotas["Office Pass weekly allowance"]).toMatchObject({ used: 37, remainingPercentage: 63 });
    expect(usage.quotas["Free model allowance"]).toMatchObject({ used: 12, remainingPercentage: 88 });
    expect(parseQuotaData("tokenharbor", usage)).toHaveLength(2);
    expect(USAGE_APIKEY_PROVIDERS).toContain("tokenharbor");
  });

  it("reports 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    const usage = await getUsageForProvider({ provider: "tokenharbor", authType: "apikey", apiKey: "bad" });
    expect(usage.message).toMatch(/authentication failed/);
  });
});
