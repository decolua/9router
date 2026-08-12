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
import {
  parseQuotaData,
  getRemainingPercentage,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Captured verbatim from the live endpoint on 2026-08-12, the day after
// anomalyco/opencode#16513 shipped. The endpoint is still undocumented, so this
// payload — not the PR description or the issue proposals — is the contract.
const SAMPLE_USAGE = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-08-12T20:23:13.083Z" },
    weekly: { status: "ok", percent: 0, resetsAt: "2026-08-17T00:00:00.083Z" },
    monthly: { status: "ok", percent: 91, resetsAt: "2026-08-25T01:33:44.083Z" },
  },
};

const conn = { provider: "opencode-go", apiKey: "sk-test" };

describe("opencode-go usage", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("is registered as an apikey-eligible usage provider", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    // Go authenticates with a plain API key, so the /api/usage route only
    // accepts the connection when usageApikey is also set.
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
  });

  it("calls the usage endpoint with bearer auth", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(SAMPLE_USAGE));
    await getUsageForProvider(conn);

    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(USAGE_URL);
    expect(options.headers.Authorization).toBe("Bearer sk-test");
  });

  it("maps the three windows to percent-based quotas", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(SAMPLE_USAGE));
    const usage = await getUsageForProvider(conn);

    expect(usage.plan).toBe("OpenCode Go");
    expect(usage.limitReached).toBe(false);
    expect(Object.keys(usage.quotas)).toEqual(["Rolling", "Weekly", "Monthly"]);
    expect(usage.quotas.Monthly).toEqual({
      used: 91,
      total: 100,
      remainingPercentage: 9,
      resetAt: "2026-08-25T01:33:44.083Z",
      unlimited: false,
    });
  });

  it("renders remaining percentage the right way round in the dashboard", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(SAMPLE_USAGE));
    const usage = await getUsageForProvider(conn);
    const rows = parseQuotaData("opencode-go", usage);

    const monthly = rows.find((r) => r.name === "Monthly");
    // 91% used must read as 9% remaining, not 91%.
    expect(getRemainingPercentage(monthly)).toBe(9);
    // Absolute `remaining` must stay unset — the UI treats it as a 0-100 percent.
    expect(monthly.remaining).toBeUndefined();
    expect(getRemainingPercentage(rows.find((r) => r.name === "Rolling"))).toBe(100);
  });

  it("flags limitReached when any window is rate-limited", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse({
        usage: {
          ...SAMPLE_USAGE.usage,
          monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-25T01:33:44.083Z" },
        },
      }),
    );
    const usage = await getUsageForProvider(conn);

    expect(usage.limitReached).toBe(true);
    expect(usage.quotas.Monthly.remainingPercentage).toBe(0);
  });

  it("drops a window with no usable percent rather than showing it as full", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse({
        usage: {
          ...SAMPLE_USAGE.usage,
          weekly: { status: "ok", resetsAt: "2026-08-17T00:00:00.083Z" }, // percent missing
        },
      }),
    );
    const usage = await getUsageForProvider(conn);

    // Defaulting the missing percent to 0 would publish "100% remaining" and
    // tell the user they have headroom they may not have.
    expect(usage.quotas).not.toHaveProperty("Weekly");
    expect(Object.keys(usage.quotas)).toEqual(["Rolling", "Monthly"]);
    expect(parseQuotaData("opencode-go", usage).find((r) => r.name === "Weekly")).toBeUndefined();
  });

  it("still flags limitReached when a rate-limited window omits percent", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse({
        usage: {
          ...SAMPLE_USAGE.usage,
          monthly: { status: "rate-limited", resetsAt: "2026-08-25T01:33:44.083Z" },
        },
      }),
    );
    const usage = await getUsageForProvider(conn);

    // status is authoritative on its own — dropping the unusable percent must
    // not also discard the "you are throttled" signal.
    expect(usage.quotas).not.toHaveProperty("Monthly");
    expect(usage.limitReached).toBe(true);
  });

  it("accepts a numeric string percent", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse({ usage: { monthly: { status: "ok", percent: "91", resetsAt: null } } }),
    );
    const usage = await getUsageForProvider(conn);
    expect(usage.quotas.Monthly.used).toBe(91);
  });

  it("reports a missing subscription (403) distinctly from an auth failure", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse(
        { type: "error", error: { type: "EntitlementError", message: "OpenCode Go subscription required." } },
        403,
      ),
    );
    const usage = await getUsageForProvider(conn);

    expect(usage.message).toBe("OpenCode Go subscription required.");
    // Must NOT read as an auth-expired message — re-authorizing cannot fix it.
    expect(usage.message.toLowerCase()).not.toContain("unauthorized");
    expect(usage.quotas).toBeUndefined();
  });

  it("surfaces a 401 as an auth failure", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse({ type: "error", error: { type: "AuthError", message: "Unauthorized" } }, 401),
    );
    expect((await getUsageForProvider(conn)).message).toBe("Unauthorized");
  });

  it("degrades to a message when the endpoint disappears or changes shape", async () => {
    // The endpoint is a day old and undocumented: a rollback serves the SPA 404 HTML.
    proxyAwareFetch.mockResolvedValue(
      new Response("<html>404</html>", { status: 404, headers: { "Content-Type": "text/html" } }),
    );
    expect(await getUsageForProvider(conn)).toMatchObject({ plan: "OpenCode Go" });
    expect((await getUsageForProvider(conn)).quotas).toBeUndefined();

    proxyAwareFetch.mockResolvedValue(jsonResponse({ unexpected: true }));
    expect((await getUsageForProvider(conn)).message).toMatch(/expected shape/);
  });

  it("never throws on a missing key or a network error", async () => {
    expect((await getUsageForProvider({ provider: "opencode-go", apiKey: null })).message).toMatch(
      /API key not available/,
    );
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockRejectedValue(new Error("boom"));
    expect((await getUsageForProvider(conn)).message).toBe("OpenCode Go error: boom");
  });
});
