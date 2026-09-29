import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import freebuff from "../../src/lib/oauth/providers/freebuff.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";

const CONFIG = {
  baseUrl: "https://freebuff.com",
  loginCodePath: "/api/auth/cli/code",
  loginStatusPath: "/api/auth/cli/status",
  oauthTimeoutMs: 300000,
};
const SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("Freebuff OAuth device flow", () => {
  it("requests a Freebuff-hosted fingerprint login code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        fingerprintId: "fp-1",
        fingerprintHash: "hash-1",
        loginUrl: "https://freebuff.com/login?auth_code=AbCd-123",
        expiresAt: Date.now() + 60000,
      }),
    }));

    const result = await freebuff.requestDeviceCode(CONFIG);

    expect(global.fetch.mock.calls[0][0]).toBe("https://freebuff.com/api/auth/cli/code");
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");
    expect(result.user_code).toBe("AbCd-123");
    expect(result.expires_in).toBe(60);
    expect(JSON.parse(result.device_code)).toMatchObject({ fingerprintId: "fp-1", fingerprintHash: "hash-1" });
  });

  it("keeps polling until the login endpoint returns an auth token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { authToken: "tok-1", id: "user-1" } }),
    }));

    const result = await freebuff.pollToken(CONFIG, JSON.stringify({ fingerprintId: "fp-1", fingerprintHash: "hash-1", expiresAt: 123 }));

    expect(global.fetch.mock.calls[0][0]).toContain("https://freebuff.com/api/auth/cli/status?");
    expect(global.fetch.mock.calls[0][1].method).toBe("GET");
    expect(result.data.access_token).toBe("tok-1");
  });

  it("keeps polling when the device-code payload is incomplete or the login is pending", async () => {
    const incomplete = await freebuff.pollToken(CONFIG, JSON.stringify({ fingerprintId: "fp-1" }));
    expect(incomplete.data).toEqual({ error: "authorization_pending" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const pending = await freebuff.pollToken(CONFIG, JSON.stringify({ fingerprintId: "fp-1", fingerprintHash: "hash-1", expiresAt: 123 }));
    expect(pending.data).toEqual({ error: "authorization_pending" });
  });

  it("uses the configured timeout when the login service omits expiresAt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fingerprintId: "fp-1", fingerprintHash: "hash-1", loginUrl: "https://freebuff.com/login" }),
    }));

    const result = await freebuff.requestDeviceCode(CONFIG);
    expect(result.user_code).toBe("");
    expect(result.expires_in).toBe(300);
  });

  it("maps a device-login token without a refresh token", () => {
    expect(freebuff.mapTokens({ access_token: "tok", id: "user-1", fingerprintId: "fp-1" })).toMatchObject({
      accessToken: "tok",
      refreshToken: null,
      providerSpecificData: { authMethod: "device_code", userId: "user-1", fingerprintId: "fp-1" },
    });
  });
});

describe("Freebuff usage", () => {
  it("registers GET-only quota reads and normalizes session limits", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: "none",
      accessTier: "limited",
      rateLimitsByModel: {
        "deepseek/deepseek-v4-flash": { limit: 6, recentCount: 4.1, resetAt: "2026-08-06T07:00:00.000Z" },
      },
    }));

    const usage = await getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" });

    expect(PROVIDERS.freebuff.usage.url).toBe(SESSION_URL);
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("freebuff");
    expect(fetchMock.mock.calls[0][0]).toBe(SESSION_URL);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(usage).toMatchObject({
      plan: "Freebuff (Limited)",
      quotas: { "deepseek/deepseek-v4-flash": { used: 4.1, total: 6, recurring: true, unlimited: false, displayName: "DeepSeek V4 Flash" } },
    });
  });

  it("returns friendly re-login, region, and pre-join responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "expired" })).resolves.toMatchObject({ message: expect.stringMatching(/re-login/i) });

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "country_blocked" }, 403));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({ message: expect.stringMatching(/region/i) });

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({ plan: "Freebuff", message: expect.stringMatching(/no session quota/i) });
  });

  it("reports banned, generic API, and network failures without throwing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "banned" }, 403));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({ message: expect.stringMatching(/banned/i) });

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 502));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({ message: expect.stringMatching(/502/) });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({ message: expect.stringMatching(/offline/) });
  });

  it("folds an active session rate limit when the shared quota map omits its model", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: "active",
      model: "deepseek/deepseek-v4-flash",
      rateLimit: { limit: 8, recentCount: 3, resetAt: "2026-08-06T07:00:00.000Z" },
      rateLimitsByModel: {},
    }));

    await expect(getUsageForProvider({ provider: "freebuff", accessToken: "tok-1" })).resolves.toMatchObject({
      plan: "Freebuff",
      quotas: { "deepseek/deepseek-v4-flash": { used: 3, total: 8, recurring: true } },
    });
  });
});
