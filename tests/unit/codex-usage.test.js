import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Codex usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the ChatGPT account id and parses Plus quota windows", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      plan_type: "plus",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 25,
          reset_after_seconds: 3600,
        },
        secondary_window: {
          used_percent: 60,
          reset_at: 1770000000,
        },
      },
    }));

    const usage = await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: {
        chatgptAccountId: "acct_123",
        chatgptPlanType: "plus",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "ChatGPT-Account-Id": "acct_123",
        }),
      }),
      null
    );
    expect(usage.plan).toBe("plus");
    expect(usage.quotas.session).toMatchObject({
      used: 25,
      remaining: 75,
      resetAt: "2026-05-25T13:00:00.000Z",
    });
    expect(usage.quotas.weekly).toMatchObject({
      used: 60,
      remaining: 40,
      resetAt: "2026-02-02T02:40:00.000Z",
    });
  });

  it("falls back to stored plan info and explains empty quota responses", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}));

    const usage = await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: { chatgptPlanType: "plus" },
    });

    expect(usage.plan).toBe("plus");
    expect(usage.quotas).toEqual({});
    expect(usage.message).toBe("Codex connected. Usage API returned no quota windows.");
  });
});
