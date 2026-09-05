import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import factory from "../../src/lib/oauth/providers/factory.js";
import { FACTORY_CONFIG, PROVIDERS } from "../../src/lib/oauth/constants/oauth.js";
import { PROVIDERS as oauthProviders, getProvider } from "../../src/lib/oauth/providers/index.js";
import { refreshFactoryToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";

const originalFetch = global.fetch;

describe("Factory OAuth & Token Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Constants & Registration", () => {
    it("has valid FACTORY_CONFIG with device code settings", () => {
      expect(FACTORY_CONFIG.id).toBe("factory");
      expect(FACTORY_CONFIG.name).toBe("Factory (Droid)");
      expect(FACTORY_CONFIG.clientId).toBe("client_01HNM792M5G5G1A2THWPXKFMXB");
      expect(FACTORY_CONFIG.deviceCodeUrl).toBe("https://api.workos.com/user_management/authorize/device");
      expect(FACTORY_CONFIG.tokenUrl).toBe("https://api.workos.com/user_management/authenticate");
      expect(FACTORY_CONFIG.verificationUri).toBe("https://auth.factory.ai/device");
      expect(FACTORY_CONFIG.usePkce).toBe(false);
      expect(FACTORY_CONFIG.allowCustomRedirectUri).toBe(false);
    });

    it("registers factory in PROVIDERS enum", () => {
      expect(PROVIDERS.FACTORY).toBe("factory");
    });

    it("registers factory in src/lib/oauth/providers/index.js", () => {
      expect(oauthProviders.factory).toBeDefined();
      expect(oauthProviders.factory.flowType).toBe("device_code");
      expect(getProvider("factory")).toBe(factory);
    });
  });

  describe("requestDeviceCode", () => {
    it("calls WorkOS device authorize endpoint and returns normalized code object", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          device_code: "workos_dc_12345",
          user_code: "ABCD-EFGH",
          verification_uri: "https://auth.factory.ai/device",
          verification_uri_complete: "https://auth.factory.ai/device?user_code=ABCD-EFGH",
          expires_in: 300,
          interval: 5,
        }),
      });

      const res = await factory.requestDeviceCode();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.workos.com/user_management/authorize/device",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );

      expect(res.device_code).toBe("workos_dc_12345");
      expect(res.user_code).toBe("ABCD-EFGH");
      expect(res.verification_uri).toBe("https://auth.factory.ai/device");
      expect(res.expires_in).toBe(300);
      expect(res.interval).toBe(5);
    });

    it("throws error when device authorize fails", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => "Unauthorized client",
      });

      await expect(factory.requestDeviceCode()).rejects.toThrow("Factory device authorization request failed");
    });
  });

  describe("pollToken", () => {
    it("polls WorkOS authenticate endpoint with device_code grant", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "token_acc_999",
          refresh_token: "token_ref_888",
          expires_in: 3600,
          user: {
            id: "user_123",
            email: "dev@example.com",
            first_name: "Droid",
            last_name: "Engineer",
          },
        }),
      });

      const result = await factory.pollToken(FACTORY_CONFIG, "workos_dc_12345");

      expect(result.ok).toBe(true);
      expect(result.data.access_token).toBe("token_acc_999");
      expect(result.data.refresh_token).toBe("token_ref_888");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.workos.com/user_management/authenticate",
        expect.objectContaining({
          method: "POST",
          body: expect.any(URLSearchParams),
        })
      );
    });

    it("returns error response for authorization_pending", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "authorization_pending",
          error_description: "The user has not yet authorized the device.",
        }),
      });

      const result = await factory.pollToken(FACTORY_CONFIG, "workos_dc_12345");
      expect(result.ok).toBe(false);
      expect(result.data.error).toBe("authorization_pending");
    });
  });

  describe("postExchange and mapTokens", () => {
    it("queries /api/cli/whoami and extracts orgId and region", async () => {
      const payload = Buffer.from(JSON.stringify({ org_id: "org_jwt_1" })).toString("base64url");
      const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          org_id: "org_whoami_2",
          region: "eu",
          user: { email: "whoami@example.com", name: "Whoami User" },
        }),
      });

      const extra = await factory.postExchange({ access_token: fakeJwt });

      expect(extra.orgId).toBe("org_whoami_2");
      expect(extra.region).toBe("eu");
      expect(extra.apiEndpoint).toBe("https://api.eu.factory.ai");

      const mapped = factory.mapTokens({
        access_token: fakeJwt,
        refresh_token: "ref_123",
        expires_in: 3600,
      }, extra);

      expect(mapped.accessToken).toBe(fakeJwt);
      expect(mapped.refreshToken).toBe("ref_123");
      expect(mapped.email).toBe("whoami@example.com");
      expect(mapped.displayName).toBe("Whoami User");
      expect(mapped.providerSpecificData.orgId).toBe("org_whoami_2");
      expect(mapped.providerSpecificData.region).toBe("eu");
      expect(mapped.providerSpecificData.apiEndpoint).toBe("https://api.eu.factory.ai");
    });
  });

  describe("refreshFactoryToken and refreshTokenByProvider", () => {
    it("refreshes token via WorkOS and includes organization_id", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new_factory_access_token",
          refresh_token: "new_factory_refresh_token",
          expires_in: 3600,
        }),
      });

      const refreshed = await refreshFactoryToken("old_refresh_token", {
        providerSpecificData: { orgId: "org_test_refresh" },
      });

      expect(refreshed.accessToken).toBe("new_factory_access_token");
      expect(refreshed.refreshToken).toBe("new_factory_refresh_token");
      expect(refreshed.expiresIn).toBe(3600);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.workos.com/user_management/authenticate",
        expect.objectContaining({
          method: "POST",
          body: expect.any(URLSearchParams),
        })
      );
    });

    it("dispatches through refreshTokenByProvider", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "dispatch_access_token",
          refresh_token: "dispatch_refresh_token",
          expires_in: 1800,
        }),
      });

      const refreshed = await refreshTokenByProvider("factory", {
        refreshToken: "dispatch_refresh_in",
        providerSpecificData: { orgId: "org_dispatch" },
      });

      expect(refreshed.accessToken).toBe("dispatch_access_token");
      expect(refreshed.refreshToken).toBe("dispatch_refresh_token");
    });

    it("returns null when refreshToken is missing", async () => {
      const refreshed = await refreshFactoryToken(null);
      expect(refreshed).toBeNull();

      const viaDispatch = await refreshTokenByProvider("factory", {});
      expect(viaDispatch).toBeNull();
    });
  });
});
