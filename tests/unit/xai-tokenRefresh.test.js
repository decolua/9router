import { describe, it, expect, vi } from "vitest";

// We can't easily import the open-sse switch logic without real PROVIDERS config,
// so verify the wrapper function shape directly via dynamic import.

describe("xai/token-refresh wrapper", () => {
  it("refreshXaiToken module loads without throwing", async () => {
    // Just verify the file imports cleanly. The actual wrapper is internal.
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    expect(typeof mod.refreshTokenByProvider).toBe("function");
    expect(typeof mod.formatProviderCredentials).toBe("function");
  });

  it("formatProviderCredentials preserves refresh metadata for xai", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = mod.formatProviderCredentials(
      "xai",
      { apiKey: "k", accessToken: "t", refreshToken: "r", expiresAt: "2030-01-01T00:00:00.000Z", providerSpecificData: { authKind: "oauth" } },
      null
    );
    expect(out).toEqual({
      apiKey: "k",
      accessToken: "t",
      refreshToken: "r",
      expiresAt: "2030-01-01T00:00:00.000Z",
      providerSpecificData: { authKind: "oauth" },
    });
  });

  it("refreshTokenByProvider returns null when refreshToken missing", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = await mod.refreshTokenByProvider("xai", { refreshToken: "" }, null);
    expect(out).toBeNull();
  });

  it("refreshTokenByProvider returns expiry and metadata for refreshed xai tokens", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
    vi.doMock("../../src/lib/oauth/services/xai.js", () => ({
      XaiService: class {
        async refreshAccessToken(refreshToken, tokenEndpoint) {
          expect(tokenEndpoint).toBe("https://auth.x.ai/oauth2/token-from-storage");
          return {
            access_token: "new-access",
            refresh_token: `${refreshToken}-rotated`,
            expires_in: 900,
            id_token: "id-token",
          };
        }
      },
    }));

    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = await mod.refreshTokenByProvider(
      "xai",
      {
        refreshToken: "old-refresh",
        providerSpecificData: {
          redirectUri: "http://127.0.0.1:56121/callback",
          tokenEndpoint: "https://auth.x.ai/oauth2/token-from-storage",
          customField: "keep-me",
        },
      },
      null
    );

    expect(out).toEqual({
      accessToken: "new-access",
      refreshToken: "old-refresh-rotated",
      expiresIn: 900,
      idToken: "id-token",
      providerSpecificData: {
        redirectUri: "http://127.0.0.1:56121/callback",
        tokenEndpoint: "https://auth.x.ai/oauth2/token-from-storage",
        customField: "keep-me",
        authKind: "oauth",
        baseUrl: "https://api.x.ai/v1",
        lastRefresh: "2026-05-21T00:00:00.000Z",
        idToken: "id-token",
      },
    });
    expect(out).not.toHaveProperty("expiresAt");

    vi.doUnmock("../../src/lib/oauth/services/xai.js");
    vi.useRealTimers();
    vi.resetModules();
  });
});
