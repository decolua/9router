import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// proxyAwareFetch captures globalThis.fetch at import time — mock the module
// (like kimi-usage.test.js) instead of stubbing global fetch for usage tests.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import glmOauthProvider from "../../src/lib/oauth/providers/glm.js";
import { getProvider } from "../../src/lib/oauth/providers";
import { PROVIDERS as TRANSPORTS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const ANTHROPIC_URL = "https://api.z.ai/api/anthropic/v1/messages";
const PLAN_KEY = "key123.secret456";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("glm registry entry (dual-auth)", () => {
  it("is an oauth+apikey provider with usage enabled", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("glm");
    expect(PROVIDER_OAUTH.glm).toBeDefined();
  });

  it("keeps the direct api.z.ai anthropic transport (no separate gateway)", () => {
    expect(TRANSPORTS.glm.baseUrl).toBe(ANTHROPIC_URL);
    expect(TRANSPORTS.glm.auth.header).toBe("x-api-key");
    // no zcode gateway/hook leftovers
    expect(TRANSPORTS.zcode).toBeUndefined();
    expect(PROVIDER_OAUTH.zcode).toBeUndefined();
  });

  it("declares the ZCode CLI polling OAuth endpoints (no refresh grant)", () => {
    expect(PROVIDER_OAUTH.glm.cliInitUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/init");
    expect(PROVIDER_OAUTH.glm.cliPollUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/poll");
    expect(PROVIDER_OAUTH.glm.businessLoginUrl).toBe("https://api.z.ai/api/auth/z/login");
    expect(PROVIDER_OAUTH.glm.refresh).toBeUndefined();
  });

  it("is wired into the generic OAuth provider registry", () => {
    expect(getProvider("glm")).toBe(glmOauthProvider);
  });
});

describe("glm OAuth flow (ZCode CLI poll protocol)", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        const entry = { url: String(url), method: init.method || "GET", init };
        calls.push(entry);
        const u = new URL(url);

        if (u.href === "https://zcode.z.ai/api/v1/oauth/cli/init") {
          return jsonResponse({
            code: 0,
            data: {
              authorize_url: "https://chat.z.ai/api/oauth/authorize?x=1",
              flow_id: "flow-123",
              poll_interval_sec: 2,
              expires_at: Math.floor(Date.now() / 1000) + 300,
            },
          });
        }
        if (u.pathname.startsWith("/api/v1/oauth/cli/poll/")) {
          if (globalThis.__glmPollState === "pending") {
            return jsonResponse({ code: 0, data: { status: "pending" } });
          }
          return jsonResponse({
            code: 0,
            data: {
              status: "ready",
              token: "zcode-jwt",
              providerId: "zai",
              user: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
              zai: { access_token: "zai-oauth-token", refresh_token: "zai-refresh-token" },
            },
          });
        }
        if (u.href === "https://api.z.ai/api/auth/z/login") {
          return jsonResponse({ code: 200, data: { access_token: "zai-business-jwt" } });
        }
        if (u.href === "https://api.z.ai/api/biz/customer/getCustomerInfo") {
          return jsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-1",
                  organizationName: "默认机构",
                  projects: [{ projectId: "p-1", projectName: "默认项目", projectType: "1" }],
                },
              ],
            },
          });
        }
        if (u.pathname.endsWith("/api_keys") && entry.method === "GET") {
          return jsonResponse({ code: 200, data: [] });
        }
        if (u.pathname.endsWith("/api_keys")) {
          return jsonResponse({ code: 200, data: { apiKey: "key123", name: "zcode-api-key" } });
        }
        if (u.pathname.endsWith("/copy/key123")) {
          return jsonResponse({ code: 200, data: { secretKey: "secret456" } });
        }
        return jsonResponse({ code: 500, msg: `unexpected ${url}` }, 500);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__glmPollState;
  });

  it("init returns the server-generated authorize URL + flow id", async () => {
    const device = await glmOauthProvider.requestDeviceCode(glmOauthProvider.config);
    expect(device.device_code).toBe("flow-123");
    expect(device.verification_uri).toBe("https://chat.z.ai/api/oauth/authorize?x=1");
    expect(device._zcodePollToken).toEqual(expect.any(String));
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(calls[0].init.body)).toEqual({ provider: "zai" });
  });

  it("maps pending poll state to authorization_pending", async () => {
    globalThis.__glmPollState = "pending";
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });
  });

  it("derives the coding-plan API key from the ready state", async () => {
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });

    expect(result.ok).toBe(true);
    expect(result.data.access_token).toBe(PLAN_KEY);
    expect(result.data._zcodeJwtToken).toBe("zcode-jwt");

    // derivation chain: business login → customer info → api_keys create → copy
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("https://api.z.ai/api/auth/z/login");
    expect(urls).toContain("https://api.z.ai/api/biz/customer/getCustomerInfo");
    expect(urls).toContain("https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys");
    expect(urls).toContain(
      "https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys/copy/key123",
    );
  });

  it("mapTokens stores the plan key + account identity (no refresh token)", () => {
    const tokens = glmOauthProvider.mapTokens({
      access_token: PLAN_KEY,
      _zcodeJwtToken: "zcode-jwt",
      _zaiBusinessToken: "zai-business-jwt",
      _zaiRefreshToken: "zai-refresh-token",
      _zcodeUser: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
    });

    expect(tokens.accessToken).toBe(PLAN_KEY);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.email).toBe("feavy@example.com");
    expect(tokens.displayName).toBe("Feavy");
    expect(tokens.providerSpecificData).toMatchObject({
      authMethod: "cli_poll",
      username: "Feavy",
      userId: "u-1",
      zcodeJwtToken: "zcode-jwt",
      zaiBusinessToken: "zai-business-jwt",
      zaiRefreshToken: "zai-refresh-token",
    });
  });

  it("fails cleanly without the poll token (restart required)", async () => {
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {});
    expect(result.data.error).toBe("access_denied");
  });
});

describe("glm executor + usage (dual-auth credentials)", () => {
  it("sends the plan key as x-api-key (no gateway hook)", () => {
    const executor = new DefaultExecutor("glm");
    const creds = { accessToken: PLAN_KEY, refreshToken: null };

    const headers = executor.buildHeaders(creds, true, ANTHROPIC_URL, "glm-5.3", {});
    expect(headers["x-api-key"]).toBe(PLAN_KEY);
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("never schedules a token refresh (no refresh grant upstream)", async () => {
    const executor = new DefaultExecutor("glm");
    const result = await executor.refreshCredentials(
      { accessToken: PLAN_KEY, refreshToken: null },
      console,
    );
    expect(result).toBeNull();
  });

  it("fetches quota with the OAuth-minted key stored on accessToken", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          level: "PRO",
          limits: [
            { type: "TOKENS_LIMIT", percentage: 35.5, number: 5, unit: 3, nextResetTime: Date.now() + 3600_000 },
          ],
        },
      }),
    );

    const usage = await getUsageForProvider(
      { provider: "glm", accessToken: PLAN_KEY, apiKey: null, providerSpecificData: {} },
      null,
    );
    expect(usage.plan).toBe("Pro");
    expect(usage.quotas["Session (5h)"].used).toBe(35.5);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/monitor/usage/quota/limit",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${PLAN_KEY}` }) }),
      null,
    );
  });

  it("still fetches quota for pasted apikey connections", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ data: { level: "PRO", limits: [] } }),
    );

    const usage = await getUsageForProvider(
      { provider: "glm", accessToken: null, apiKey: PLAN_KEY, providerSpecificData: {} },
      null,
    );
    expect(usage.plan).toBe("Pro");
  });
});
