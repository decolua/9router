import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["BACKOFF_BASE_MS", "BACKOFF_MAX_MS", "BACKOFF_MAX_LEVEL"];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearBackoffEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function loadBackoff(config = {}) {
  clearBackoffEnv();
  Object.assign(process.env, config);
  vi.resetModules();
  const [errorConfig, accountFallback] = await Promise.all([
    import("../../open-sse/config/errorConfig.js"),
    import("../../open-sse/services/accountFallback.js")
  ]);
  return { ...errorConfig, ...accountFallback };
}

afterEach(() => {
  clearBackoffEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
});

describe("configurable 429 account backoff (#3343)", () => {
  it("keeps the historical schedule when no environment configuration is supplied", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown, checkFallbackError } = await loadBackoff();

    expect(BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });
    expect(getQuotaCooldown(1)).toBe(2000);
    expect(getQuotaCooldown(2)).toBe(4000);
    expect(checkFallbackError(429, "", 0)).toMatchObject({ cooldownMs: 2000, newBackoffLevel: 1 });
  });

  it("uses a configured schedule for both 429 status and rate-limit text matches", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown, checkFallbackError, applyErrorState } = await loadBackoff({
      BACKOFF_BASE_MS: "3000",
      BACKOFF_MAX_MS: "10000",
      BACKOFF_MAX_LEVEL: "5"
    });

    expect(BACKOFF_CONFIG).toEqual({ base: 3000, max: 10000, maxLevel: 5 });
    expect(getQuotaCooldown(1)).toBe(3000);
    expect(getQuotaCooldown(3)).toBe(10000);
    expect(checkFallbackError(429, "", 0)).toMatchObject({ cooldownMs: 3000, newBackoffLevel: 1 });
    expect(checkFallbackError(500, "provider rate limit", 1)).toMatchObject({ cooldownMs: 6000, newBackoffLevel: 2 });
    expect(checkFallbackError(429, "", 5)).toMatchObject({ cooldownMs: 10000, newBackoffLevel: 5 });

    const nextAccount = applyErrorState({ id: "account-1", backoffLevel: 2 }, 429, "rate limit");
    expect(nextAccount.backoffLevel).toBe(3);
    expect(new Date(nextAccount.rateLimitedUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it("lets each valid knob override its default without requiring the other knobs", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown } = await loadBackoff({
      BACKOFF_MAX_MS: "10000"
    });

    expect(BACKOFF_CONFIG).toEqual({ base: 2000, max: 10000, maxLevel: 15 });
    expect(getQuotaCooldown(4)).toBe(10000);
  });

  it("falls back per invalid knob and rejects a contradictory schedule", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown } = await loadBackoff({
      BACKOFF_BASE_MS: "5000",
      BACKOFF_MAX_MS: "2000",
      BACKOFF_MAX_LEVEL: "not-a-number"
    });

    expect(BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });
    expect(getQuotaCooldown(1)).toBe(2000);

    const withMalformedLevel = await loadBackoff({
      BACKOFF_BASE_MS: "3000",
      BACKOFF_MAX_MS: "10000",
      BACKOFF_MAX_LEVEL: "not-a-number"
    });
    expect(withMalformedLevel.BACKOFF_CONFIG).toEqual({ base: 3000, max: 10000, maxLevel: 15 });
  });
});
