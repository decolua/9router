import { describe, it, expect, beforeEach } from "vitest";
import {
  rateLimitAccountKey,
  rateLimitWindows,
  recordRateLimitEvent,
  resetRateLimitWindows,
  windowsToQuotas,
} from "open-sse/executors/claudeCliRateLimits.js";

/**
 * Where a token account's quota comes from.
 *
 * The OAuth usage endpoint refuses a credential from `claude setup-token` —
 * measured: 403, "OAuth token does not meet scope requirement user:profile" —
 * and that is the only credential kind that works in a container. Those
 * accounts showed no quota at all. The CLI reports the same two windows on
 * every routed request, so they are recorded as they go past.
 */

beforeEach(() => resetRateLimitWindows());

const EVENT = {
  status: "allowed",
  rateLimitType: "five_hour",
  unifiedWindows: {
    five_hour: { utilization: 0.28, resetsAt: 1790157000 },
    seven_day: { utilization: 0.49, resetsAt: 1790319600 },
  },
};

describe("rateLimitAccountKey", () => {
  it("keys a config-directory account by its directory", () => {
    expect(rateLimitAccountKey({ configDir: "/home/a/.claude" })).toBe("dir:/home/a/.claude");
  });

  it("keys a token account without carrying the token", () => {
    const key = rateLimitAccountKey({ oauthToken: "sk-ant-oat01-secret" });
    expect(key).toMatch(/^tok:[0-9a-f]{16}$/);
    expect(key).not.toContain("secret");
  });

  it("keys an account that carries both by the one that actually runs", () => {
    // CLAUDE_CODE_OAUTH_TOKEN overrides what the config directory has stored,
    // so the token names the subscription the request ran against; keying on
    // the directory filed the usage under an identity it was not using.
    const both = { configDir: "/home/a/.claude", oauthToken: "sk-ant-oat01-secret" };
    expect(rateLimitAccountKey(both)).toBe(rateLimitAccountKey({ oauthToken: "sk-ant-oat01-secret" }));
    expect(rateLimitAccountKey(both)).not.toBe(rateLimitAccountKey({ configDir: "/home/a/.claude" }));
  });

  it("gives two accounts two keys, and one account one", () => {
    expect(rateLimitAccountKey({ oauthToken: "a" })).not.toBe(rateLimitAccountKey({ oauthToken: "b" }));
    expect(rateLimitAccountKey({ oauthToken: "a" })).toBe(rateLimitAccountKey({ oauthToken: "a" }));
  });

  it("has no key for an account with neither", () => {
    expect(rateLimitAccountKey({})).toBe("");
    expect(rateLimitAccountKey()).toBe("");
  });
});

describe("recordRateLimitEvent", () => {
  it("keeps what a routed request was told", () => {
    recordRateLimitEvent({ oauthToken: "t" }, EVENT);
    expect(rateLimitWindows({ oauthToken: "t" })?.windows).toEqual(EVENT.unifiedWindows);
  });

  it("keeps each account's own", () => {
    recordRateLimitEvent({ oauthToken: "a" }, EVENT);
    expect(rateLimitWindows({ oauthToken: "b" })).toBeNull();
  });

  it("replaces an older reading with a newer one", () => {
    recordRateLimitEvent({ oauthToken: "t" }, EVENT);
    recordRateLimitEvent({ oauthToken: "t" }, {
      unifiedWindows: { five_hour: { utilization: 0.9, resetsAt: 1790157000 } },
    });
    expect(rateLimitWindows({ oauthToken: "t" }).windows.five_hour.utilization).toBe(0.9);
  });

  it("ignores an event with nothing in it, rather than storing a hole", () => {
    recordRateLimitEvent({ oauthToken: "t" }, {});
    recordRateLimitEvent({ oauthToken: "t" }, null);
    recordRateLimitEvent({}, EVENT);
    expect(rateLimitWindows({ oauthToken: "t" })).toBeNull();
  });
});

describe("windowsToQuotas", () => {
  it("renders as the same two windows the usage endpoint gives", () => {
    // Utilization is a fraction here and a percentage there; the card only ever
    // sees the percentage.
    expect(windowsToQuotas(EVENT.unifiedWindows)).toEqual({
      "session (5h)": {
        used: 28, total: 100, remaining: 72, remainingPercentage: 72,
        resetAt: new Date(1790157000 * 1000).toISOString(), unlimited: false,
      },
      "weekly (7d)": {
        used: 49, total: 100, remaining: 51, remainingPercentage: 51,
        resetAt: new Date(1790319600 * 1000).toISOString(), unlimited: false,
      },
    });
  });

  it("keeps a window that has no reset, which still has a bar to draw", () => {
    const quotas = windowsToQuotas({ five_hour: { utilization: 0.1 } });
    expect(quotas["session (5h)"].remaining).toBe(90);
    expect(quotas["session (5h)"].resetAt).toBeNull();
  });

  it("clamps a utilization outside the window rather than drawing past the end", () => {
    expect(windowsToQuotas({ five_hour: { utilization: 1.4 } })["session (5h)"].used).toBe(100);
    expect(windowsToQuotas({ five_hour: { utilization: -1 } })["session (5h)"].used).toBe(0);
  });

  it("is nothing when there is nothing usable, so the caller can fall back", () => {
    expect(windowsToQuotas(null)).toBeNull();
    expect(windowsToQuotas({})).toBeNull();
    expect(windowsToQuotas({ five_hour: { utilization: "lots" } })).toBeNull();
  });
});
