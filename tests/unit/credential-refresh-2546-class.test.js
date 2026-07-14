/**
 * Regression tests for the proactive-token-refresh hardening (issue #2546 class).
 *
 * Root cause of #2546: providers whose `mapTokens` only emitted `expiresIn`
 * (grok-cli, gemini-cli) never set `expiresAt`. `getCredentialExpiryMs` ignored
 * `expiresIn`, so proactive refresh (`shouldRefreshCredentials`) silently no-op'd
 * and sessions died when the upstream token expired mid-session.
 *
 * Fix: `getCredentialExpiryMs` now derives an absolute expiry from `expiresIn`
 * when `expiresAt` is absent. This single change covers every provider that
 * maps only `expiresIn` — no per-provider patch needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("proactive token refresh expiry resolution (#2546 class)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("explicit expiresAt still wins", async () => {
    const { getCredentialExpiryMs } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const at = new Date(Date.now() + 120 * 1000).toISOString();
    expect(getCredentialExpiryMs({ expiresAt: at })).toBe(new Date(at).getTime());
  });

  it("derives expiry from expiresIn when expiresAt is absent (grok-cli/gemini-cli shape)", async () => {
    const { getCredentialExpiryMs } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const now = 1_000_000_000_000;
    const ms = getCredentialExpiryMs({ expiresIn: 3600 }, now);
    expect(ms).toBe(now + 3600 * 1000);
  });

  it("expiresIn=0 / missing yields null (no false refresh)", async () => {
    const { getCredentialExpiryMs } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    expect(getCredentialExpiryMs({ expiresIn: 0 })).toBeNull();
    expect(getCredentialExpiryMs({})).toBeNull();
  });

  it("shouldRefreshCredentials fires for a near-expiry expiresIn-only token", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const creds = {
      connectionId: "grok-1",
      refreshToken: "rt",
      expiresIn: 30, // 30s left, no expiresAt
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(true);
  });

  it("shouldRefreshCredentials does NOT fire for a long-lived expiresIn-only token", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const creds = {
      connectionId: "grok-2",
      refreshToken: "rt",
      expiresIn: 30 * 24 * 60 * 60, // ~30 days
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(false);
  });
});

describe("unified credential refresh facade (credentialRefresh.js)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes an expiresIn-only credential through the registry refresh path", async () => {
    const oauth = await import("../../open-sse/services/oauthCredentialManager.js");
    const token = await import("../../open-sse/services/tokenRefresh.js");
    const called = vi.fn();
    vi.spyOn(oauth, "shouldRefreshCredentials").mockReturnValue(false);
    vi.spyOn(oauth, "refreshProviderCredentials").mockImplementation(called);
    vi.spyOn(token, "getAccessToken").mockImplementation(called);

    const { refreshProviderCredentialsUnified } = await import(
      "../../open-sse/services/credentialRefresh.js"
    );
    const creds = { expiresIn: 3600, refreshToken: "rt" };
    await refreshProviderCredentialsUnified("grok-cli", creds, {});
    // Not expired -> shouldRefreshCredentials false -> no refresh, no legacy getAccessToken
    expect(called).not.toHaveBeenCalled();
  });

  it("routes a credential without expiry through the legacy getAccessToken path", async () => {
    const token = await import("../../open-sse/services/tokenRefresh.js");
    const oauth = await import("../../open-sse/services/oauthCredentialManager.js");
    const legacy = vi.fn().mockResolvedValue({ accessToken: "x" });
    vi.spyOn(token, "getAccessToken").mockImplementation(legacy);
    vi.spyOn(oauth, "refreshProviderCredentials");
    vi.spyOn(oauth, "shouldRefreshCredentials");

    const { refreshProviderCredentialsUnified } = await import(
      "../../open-sse/services/credentialRefresh.js"
    );
    await refreshProviderCredentialsUnified("some-cli", { refreshToken: "rt" }, {});
    expect(legacy).toHaveBeenCalledOnce();
  });
});
