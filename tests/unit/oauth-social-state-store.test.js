import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  saveSocialOAuthState,
  consumeSocialOAuthState,
  clearSocialOAuthStates,
} from "../../src/lib/oauth/socialStateStore.js";
import { sanitizeAwsRegion } from "../../src/lib/oauth/constants/oauth.js";

describe("socialStateStore CSRF state lifecycle", () => {
  beforeEach(() => {
    clearSocialOAuthStates();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSocialOAuthStates();
  });

  it("returns the stored record on first consume and validates the provider", () => {
    saveSocialOAuthState("s1", { provider: "google", codeVerifier: "v1" });
    expect(consumeSocialOAuthState("s1", { provider: "google" })).toMatchObject({
      provider: "google",
      codeVerifier: "v1",
    });
  });

  it("is single-use: a replayed state is rejected on the second consume", () => {
    saveSocialOAuthState("replay", { provider: "google", codeVerifier: "v1" });
    expect(consumeSocialOAuthState("replay", { provider: "google" })).toBeTruthy();
    // Second attempt with the same state must fail (CSRF replay guard).
    expect(consumeSocialOAuthState("replay", { provider: "google" })).toBeNull();
  });

  it("rejects when the consume provider does not match the stored provider", () => {
    saveSocialOAuthState("mism", { provider: "google", codeVerifier: "v1" });
    expect(consumeSocialOAuthState("mism", { provider: "github" })).toBeNull();
    // The state is consumed (deleted) even on mismatch, so it cannot be retried.
    saveSocialOAuthState("mism2", { provider: "google", codeVerifier: "v1" });
    consumeSocialOAuthState("mism2", { provider: "github" });
    expect(consumeSocialOAuthState("mism2", { provider: "google" })).toBeNull();
  });

  it("expires a state once its TTL elapses (lazy expiry on read)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    saveSocialOAuthState("ttl", { provider: "google", codeVerifier: "v1" }, 10 * 60 * 1000);

    // Just before TTL: still valid.
    vi.setSystemTime(new Date("2026-06-01T00:09:59.000Z"));
    // Use a fresh state for the "still valid" check since consume is destructive.
    saveSocialOAuthState("ttl-valid", { provider: "google", codeVerifier: "v1" }, 10 * 60 * 1000);
    expect(consumeSocialOAuthState("ttl-valid", { provider: "google" })).toBeTruthy();

    // Past TTL of the original "ttl" entry: rejected.
    vi.setSystemTime(new Date("2026-06-01T00:10:01.000Z"));
    expect(consumeSocialOAuthState("ttl", { provider: "google" })).toBeNull();
  });

  it("enforces a hard cap by evicting the oldest entries (unbounded-growth DoS guard)", () => {
    const MAX = 5000;
    for (let i = 0; i < MAX; i++) {
      saveSocialOAuthState(`k${i}`, { provider: "google", codeVerifier: `v${i}` });
    }
    // One more insert past the cap must evict the oldest (k0), not grow unbounded.
    saveSocialOAuthState("overflow", { provider: "google", codeVerifier: "v-of" });
    expect(consumeSocialOAuthState("overflow", { provider: "google" })).toBeTruthy();
    expect(consumeSocialOAuthState("k0", { provider: "google" })).toBeNull();
  });
});

describe("sanitizeAwsRegion", () => {
  it("accepts well-formed AWS region ids across partitions", () => {
    for (const r of ["us-east-1", "ap-southeast-2", "eu-west-3", "us-gov-east-1", "us-iso-east-1"]) {
      expect(sanitizeAwsRegion(r)).toBe(r);
    }
  });

  it("falls back to the safe default for malicious or malformed region values", () => {
    const malicious = [
      "evil.com/x?",
      "us-east-1.evil.com",
      "../../etc",
      "US-EAST-1",
      "us_east_1",
      "",
      "   ",
      "oidc.us-east-1.amazonaws.com",
    ];
    for (const r of malicious) {
      expect(sanitizeAwsRegion(r)).toBe("us-east-1");
    }
  });

  it("honors a custom fallback and rejects non-string input", () => {
    expect(sanitizeAwsRegion(undefined, "eu-west-1")).toBe("eu-west-1");
    expect(sanitizeAwsRegion(null)).toBe("us-east-1");
    expect(sanitizeAwsRegion(123)).toBe("us-east-1");
    expect(sanitizeAwsRegion({ region: "us-east-1" })).toBe("us-east-1");
  });
});
