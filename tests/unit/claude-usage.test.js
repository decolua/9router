import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getClaudeUsage } from "../../open-sse/services/usage/claude.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const minimalUsage = {
  five_hour: { utilization: 0, resets_at: null },
};

describe("Claude OAuth usage", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normalizes complete quota windows without duplicate or inactive-row loss", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      five_hour: { utilization: 0, resets_at: null },
      seven_day: { utilization: 25, resets_at: "2026-08-02T00:00:00Z" },
      seven_day_opus: { utilization: 9, resets_at: null },
      limits: [
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 0,
          resets_at: "2026-08-01T00:00:00Z",
          is_active: false,
          scope: { model: { display_name: "Fable" } },
        },
      ],
      rate_limits: [
        { kind: "session", group: "session", percent: 0, resets_at: null },
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 0,
          resets_at: "2026-08-01T00:00:00Z",
          scope: { model: { display_name: "fable" } },
        },
      ],
    }));

    const result = await getClaudeUsage("quota-shape-token");

    expect(result.quotas).toEqual({
      "session (5h)": {
        used: 0,
        total: 100,
        remaining: 100,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      },
      "weekly (7d)": {
        used: 25,
        total: 100,
        remaining: 75,
        remainingPercentage: 75,
        resetAt: "2026-08-02T00:00:00.000Z",
        unlimited: false,
      },
      "weekly opus (7d)": {
        used: 9,
        total: 100,
        remaining: 91,
        remainingPercentage: 91,
        resetAt: null,
        unlimited: false,
      },
      "weekly Fable (7d)": {
        used: 0,
        total: 100,
        remaining: 100,
        remainingPercentage: 100,
        resetAt: "2026-08-01T00:00:00.000Z",
        unlimited: false,
      },
    });
  });

  it("bounds the OAuth usage request duration", async () => {
    const timeoutSignal = new AbortController().signal;
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(minimalUsage));

    await getClaudeUsage("timeout-token", { connectionProxyEnabled: true });

    const [, options, proxyOptions] = proxyAwareFetch.mock.calls[0];
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5_000);
    expect(options.signal).toBe(timeoutSignal);
    expect(proxyOptions).toEqual({ connectionProxyEnabled: true });
  });

  it("coalesces concurrent reads for one credential", async () => {
    let resolveFetch;
    proxyAwareFetch.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const first = getClaudeUsage("coalesce-token");
    const second = getClaudeUsage("coalesce-token");
    resolveFetch(jsonResponse(minimalUsage));

    const [a, b] = await Promise.all([first, second]);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("bounds concurrent credential polls", async () => {
    const resolvers = [];
    proxyAwareFetch.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));

    const requests = Array.from(
      { length: 129 },
      (_, index) => getClaudeUsage(`bounded-token-${index}`),
    );
    const coalesced = getClaudeUsage("bounded-token-0");
    const fetchCount = proxyAwareFetch.mock.calls.length;
    for (const resolve of resolvers) resolve(jsonResponse(minimalUsage));
    const results = await Promise.all(requests);

    expect(fetchCount).toBe(128);
    expect(results[128]).toMatchObject({ message: expect.stringMatching(/busy|retry/i) });
    await expect(coalesced).resolves.toEqual(results[0]);
  });

  it("starts success TTL when the upstream response completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    let resolveFetch;
    proxyAwareFetch
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFetch = resolve;
      }))
      .mockImplementation(() => Promise.resolve(jsonResponse(minimalUsage)));

    const pending = getClaudeUsage("slow-success-token");
    vi.advanceTimersByTime(60_000);
    resolveFetch(jsonResponse(minimalUsage));
    const fresh = await pending;

    vi.advanceTimersByTime(64_999);
    const cached = await getClaudeUsage("slow-success-token");
    vi.advanceTimersByTime(2);
    const refreshed = await getClaudeUsage("slow-success-token");

    expect(cached).toEqual(fresh);
    expect(refreshed).toEqual(fresh);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("returns stale success on 429 without legacy fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(minimalUsage))
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ plan: "Max" }));

    const fresh = await getClaudeUsage("stale-token");
    vi.advanceTimersByTime(65_001);
    const stale = await getClaudeUsage("stale-token");

    expect(stale).toEqual(fresh);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/api/oauth/usage",
      "https://api.anthropic.com/api/oauth/usage",
    ]);
  });

  it.each([
    [
      "Retry-After seconds",
      {
        "Retry-After": "600",
        "anthropic-ratelimit-unified-reset": "2026-07-26T00:30:00Z",
      },
    ],
    ["Retry-After date", { "Retry-After": "Sun, 26 Jul 2026 00:10:00 GMT" }],
    ["RFC3339 reset", { "anthropic-ratelimit-tokens-reset": "2026-07-26T00:10:00Z" }],
    [
      "epoch-seconds reset",
      { "anthropic-ratelimit-tokens-reset": String(Date.parse("2026-07-26T00:10:00Z") / 1000) },
    ],
    [
      "epoch-milliseconds reset",
      { "anthropic-ratelimit-tokens-reset": String(Date.parse("2026-07-26T00:10:00Z")) },
    ],
  ])("honors %s cooldown", async (name, headers) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429, headers))
      .mockResolvedValueOnce(jsonResponse(minimalUsage));

    await getClaudeUsage(`cooldown-${name}`);
    vi.advanceTimersByTime(599_999);
    await getClaudeUsage(`cooldown-${name}`);
    const callsDuringCooldown = proxyAwareFetch.mock.calls.length;
    vi.advanceTimersByTime(2);
    await getClaudeUsage(`cooldown-${name}`);

    expect(callsDuringCooldown).toBe(1);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, false],
    [403, false],
    [500, false],
    [404, true],
    [405, true],
  ])("uses legacy only for unsupported OAuth status %i", async (status, usesLegacy) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}, status))
      .mockResolvedValueOnce(jsonResponse({ plan: "Max" }));

    const result = await getClaudeUsage(`status-${status}-token`);

    expect(proxyAwareFetch).toHaveBeenCalledTimes(usesLegacy ? 2 : 1);
    if (usesLegacy) {
      expect(result).toMatchObject({ plan: "Max" });
      expect(proxyAwareFetch.mock.calls[1][0]).toBe("https://api.anthropic.com/v1/settings");
    } else if (status === 401) {
      expect(result.message).toMatch(/authentication|401|re-authorize/i);
    } else {
      expect(result.message).toContain(`HTTP ${status}`);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("caches successful legacy usage", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ plan: "Max" }))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ plan: "Max" }));

    const first = await getClaudeUsage("legacy-cache-token");
    const cached = await getClaudeUsage("legacy-cache-token");

    expect(first).toMatchObject({ plan: "Max" });
    expect(cached).toEqual(first);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("retries transient legacy failures", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ plan: "Max" }));

    const failed = await getClaudeUsage("legacy-retry-token");
    const retried = await getClaudeUsage("legacy-retry-token");

    expect(failed.message).toMatch(/admin permissions/i);
    expect(retried).toMatchObject({ plan: "Max" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
  });

  it.each(["OAuth", "legacy"])("does not expose raw %s transport errors", async (path) => {
    const token = `secret-${path}-token`;
    const detail = `request failed with ${token}`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    if (path === "legacy") {
      proxyAwareFetch
        .mockResolvedValueOnce(jsonResponse({}, 404))
        .mockRejectedValueOnce(new Error(detail));
    } else {
      proxyAwareFetch.mockRejectedValueOnce(new Error(detail));
    }

    const result = await getClaudeUsage(token);

    expect(result).toEqual({ message: "Claude connected. Unable to fetch usage." });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(detail);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
