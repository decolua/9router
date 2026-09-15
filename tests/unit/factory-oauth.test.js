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
    it("omits external alphanumeric Factory orgId from WorkOS refresh payload to prevent 400 rejection", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new_factory_access_token",
          refresh_token: "new_factory_refresh_token",
          expires_in: 3600,
        }),
      });

      const refreshed = await refreshFactoryToken("old_refresh_token", {
        providerSpecificData: { orgId: "RFmWaCAuH8jTGM21tL5k", region: "eu" },
      });

      expect(refreshed.accessToken).toBe("new_factory_access_token");
      expect(refreshed.refreshToken).toBe("new_factory_refresh_token");
      expect(refreshed.expiresIn).toBe(3600);
      expect(refreshed.providerSpecificData.orgId).toBe("RFmWaCAuH8jTGM21tL5k");

      const call = global.fetch.mock.calls[0];
      const body = call[1].body;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("client_01HNM792M5G5G1A2THWPXKFMXB");
      expect(body.get("refresh_token")).toBe("old_refresh_token");
      expect(body.get("organization_id")).toBeNull();
    });

    it("includes organization_id when orgId matches WorkOS internal org pattern", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new_factory_access_token",
          refresh_token: "new_factory_refresh_token",
          expires_in: 3600,
        }),
      });

      const refreshed = await refreshFactoryToken("old_refresh_token_workos_pattern", {
        providerSpecificData: { orgId: "org_workos_123" },
      });

      expect(refreshed.accessToken).toBe("new_factory_access_token");
      const call = global.fetch.mock.calls[0];
      const body = call[1].body;
      expect(body.get("organization_id")).toBe("org_workos_123");
    });

    it("retries on transient 429/500 errors and succeeds", async () => {
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return { ok: false, status: 429, text: async () => "Rate limited" };
        }
        return {
          ok: true,
          json: async () => ({
            access_token: "retry_success_token",
            refresh_token: "retry_success_refresh",
            expires_in: 3600,
          }),
        };
      });

      const refreshed = await refreshFactoryToken("transient_refresh_token", {});
      expect(refreshed.accessToken).toBe("retry_success_token");
      expect(attempts).toBe(2);
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

    it("backfills orgId from refreshed access token JWT when credentials lack orgId", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64");
      const payload = Buffer.from(JSON.stringify({ org_id: "org_backfilled_999" })).toString("base64");
      const jwtWithOrg = `${header}.${payload}.signature`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: jwtWithOrg,
          refresh_token: "ref_backfill_tok",
          expires_in: 3600,
        }),
      });

      const refreshed = await refreshFactoryToken("token_for_backfill_test", {});
      expect(refreshed.accessToken).toBe(jwtWithOrg);
      expect(refreshed.providerSpecificData?.orgId).toBe("org_backfilled_999");
    });

    it("derives expiresIn and expiresAt from JWT exp claim when WorkOS omits expires_in", async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 86400; // 24 hours
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64");
      const payload = Buffer.from(JSON.stringify({ exp: futureExp, org_id: "org_exp_test" })).toString("base64");
      const jwtToken = `${header}.${payload}.sig`;

      // Real WorkOS responses omit expires_in!
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: jwtToken,
          refresh_token: "new_rotated_refresh_token",
        }),
      });

      const refreshed = await refreshFactoryToken("valid_refresh_token", {});
      expect(refreshed.accessToken).toBe(jwtToken);
      expect(refreshed.refreshToken).toBe("new_rotated_refresh_token");
      expect(refreshed.expiresIn).toBeGreaterThan(86300);
      expect(refreshed.expiresIn).toBeLessThanOrEqual(86400);
      expect(refreshed.expiresAt).toBe(new Date(futureExp * 1000).toISOString());
    });

    it("classifies permanent OAuth error as unrecoverable_refresh_error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "invalid_grant", error_description: "The authorization grant is invalid" }),
      });

      const failure = await refreshFactoryToken("dead_refresh_token_unrecoverable", {});
      expect(failure?.error).toBe("unrecoverable_refresh_error");
    });

    it("returns null when refreshToken is missing", async () => {
      const refreshed = await refreshFactoryToken(null);
      expect(refreshed).toBeNull();

      const viaDispatch = await refreshTokenByProvider("factory", {});
      expect(viaDispatch).toBeNull();
    });
  });

  describe("FactoryExecutor refresh integration", () => {
    it("implements refreshCredentials and needsRefresh on FactoryExecutor", async () => {
      const { FactoryExecutor } = await import("../../open-sse/executors/factory.js");
      const executor = new FactoryExecutor();

      expect(typeof executor.refreshCredentials).toBe("function");
      expect(typeof executor.needsRefresh).toBe("function");

      // Without refresh token, returns null
      const noRt = await executor.refreshCredentials({});
      expect(noRt).toBeNull();

      // Fresh token does not need refresh
      const future = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
      expect(executor.needsRefresh({ expiresAt: future })).toBe(false);

      // Expired or near-expiry token needs refresh
      const nearExpiry = new Date(Date.now() + 60 * 1000).toISOString();
      expect(executor.needsRefresh({ expiresAt: nearExpiry })).toBe(true);
    });
  });
});
