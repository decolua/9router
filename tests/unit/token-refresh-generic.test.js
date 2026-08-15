/**
 * Generic OAuth2 token refresh — config-driven profiles.
 *
 * Verifies refreshAccessToken() handles the 4 foldable providers
 * (iflow, github, kimi, claude) via a REFRESH_PROFILES table,
 * while preserving the legacy generic path for unknown providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

function mockFetchOnce(payload, { ok = true, status = 200 } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  });
  global.fetch = fn;
  return fn;
}

describe("refreshAccessToken — config-driven profiles", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); global.fetch = originalFetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("iflow: Basic Auth header from clientId:clientSecret, form body keeps client_secret", async () => {
    const fm = mockFetchOnce({ access_token: "if-acc", refresh_token: "if-rot", expires_in: 3600 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");

    await refreshAccessToken("iflow", "if-old", {}, console);

    const [, init] = fm.mock.calls[0];
    expect(init.headers["Authorization"]).toMatch(/^Basic /);
    const body = new URLSearchParams(init.body);
    expect(body.get("client_id")).toBeTruthy();
    expect(body.get("client_secret")).toBeTruthy();
  });

  it("github: omits client_secret when config has none", async () => {
    const fm = mockFetchOnce({ access_token: "gh-acc", expires_in: 28800 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");

    const out = await refreshAccessToken("github", "gh-old", {}, console);

    const body = new URLSearchParams(fm.mock.calls[0][1].body);
    expect(body.get("client_secret")).toBeNull();
    expect(out.accessToken).toBe("gh-acc");
    expect(out.refreshToken).toBe("gh-old");
  });

  it("kimi: merges X-Msh-* headers from credentials.providerSpecificData.deviceId", async () => {
    const fm = mockFetchOnce({ access_token: "km-acc", expires_in: 86400 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");

    await refreshAccessToken("kimi", "km-old", {
      providerSpecificData: { deviceId: "dev-xyz" },
    }, console);

    const headers = fm.mock.calls[0][1].headers;
    // Kimi's buildKimiHeaders must contribute at least one X-Msh- header
    const mshKeys = Object.keys(headers).filter((k) => k.toLowerCase().startsWith("x-msh-"));
    expect(mshKeys.length).toBeGreaterThan(0);
  });

  it("claude: JSON body, client_id only (no client_secret)", async () => {
    const fm = mockFetchOnce({ access_token: "cl-acc", refresh_token: "cl-rot", expires_in: 3600 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");

    await refreshAccessToken("claude", "cl-old", {}, console);

    const [, init] = fm.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(init.body);
    expect(parsed.grant_type).toBe("refresh_token");
    expect(parsed.client_id).toBeTruthy();
    expect(parsed).not.toHaveProperty("client_secret");
  });

  it("returns null on non-ok response", async () => {
    mockFetchOnce({ error: "invalid_grant" }, { ok: false, status: 400 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");
    const out = await refreshAccessToken("iflow", "dead", {}, console);
    expect(out).toBeNull();
  });

  it("returns null when refreshToken missing", async () => {
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");
    const out = await refreshAccessToken("iflow", "", {}, console);
    expect(out).toBeNull();
  });

  it("dedupes concurrent calls with same refresh token (same dedupKey)", async () => {
    const fm = mockFetchOnce({ access_token: "dd-acc", expires_in: 3600 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");
    const creds = { providerSpecificData: { deviceId: "d" } };
    await Promise.all([
      refreshAccessToken("kimi", "dup-refresh", creds, console),
      refreshAccessToken("kimi", "dup-refresh", creds, console),
    ]);
    expect(fm).toHaveBeenCalledTimes(1);
  });
});

describe("refreshAccessToken — legacy generic path (no profile)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); global.fetch = originalFetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("still works for an unprofiled provider via config.refreshUrl/clientId/clientSecret", async () => {
    const fm = mockFetchOnce({ access_token: "gen-acc", expires_in: 3600 });
    const { refreshAccessToken } = await import("open-sse/services/tokenRefresh/providers.js");

    await refreshAccessToken("cline", "gen-old", {}, console);

    const body = new URLSearchParams(fm.mock.calls[0][1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBeTruthy();
  });
});
