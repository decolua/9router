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
import { resolveTransport } from "../../open-sse/services/provider.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { GlmExecutor } from "../../open-sse/executors/glm.js";
import { applyZcodeHeaders, __test__ as zcodeHeaderTest } from "../../src/lib/zcode/headers.js";
import { injectZcodeSystemPrompt } from "../../src/lib/zcode/systemPrompt.js";

const ANTHROPIC_URL = "https://api.z.ai/api/anthropic/v1/messages";
const ZCODE_PLAN_URL = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";
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

  it("declares selectable ZCode plans while keeping hidden card modes out of the UI", () => {
    expect(TRANSPORTS.glm.defaultPlan).toBe("individual-coding-plan");
    expect(TRANSPORTS.glm.plans["start-plan"].baseUrl).toBe(ZCODE_PLAN_URL);
    expect(TRANSPORTS.glm.plans["start-plan"].supportedModels).toContain("glm-5.3");
    expect(TRANSPORTS.glm.plans["off-peak"].hidden).toBe(true);
    expect(TRANSPORTS.glm.plans.highspeed.hidden).toBe(true);
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
                  projects: [
                    { projectId: "p-1", projectName: "默认项目", projectType: "1" },
                    { projectId: "p-team", projectName: "Team", projectType: "2" },
                  ],
                },
              ],
            },
          });
        }
        if (u.pathname.endsWith("/api_keys") && entry.method === "GET") {
          return jsonResponse({ code: 200, data: [] });
        }
        if (u.pathname.endsWith("/api_keys")) {
          return jsonResponse({
            code: 200,
            data: { apiKey: u.pathname.includes("p-team") ? "teamkey" : "key123", name: "zcode-api-key" },
          });
        }
        if (u.pathname.endsWith("/copy/key123") || u.pathname.endsWith("/copy/teamkey")) {
          return jsonResponse({
            code: 200,
            data: { secretKey: u.pathname.endsWith("teamkey") ? "teamsecret" : "secret456" },
          });
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
    expect(result.data._individualCodingPlanApiKey).toBe(PLAN_KEY);
    expect(result.data._teamCodingPlanApiKey).toBe("teamkey.teamsecret");

    // derivation chain: business login → customer info → api_keys create → copy
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("https://api.z.ai/api/auth/z/login");
    expect(urls).toContain("https://api.z.ai/api/biz/customer/getCustomerInfo");
    expect(urls).toContain("https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys");
    expect(urls).toContain("https://api.z.ai/api/biz/v1/organization/org-1/projects/p-team/api_keys");
    expect(urls).toContain(
      "https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys/copy/key123",
    );
  });

  it("mapTokens stores the plan key + account identity (no refresh token)", () => {
    const tokens = glmOauthProvider.mapTokens({
      access_token: PLAN_KEY,
      _zcodeJwtToken: "zcode-jwt",
      _zaiBusinessToken: "zai-business-jwt",
      _individualCodingPlanApiKey: PLAN_KEY,
      _teamCodingPlanApiKey: "teamkey.teamsecret",
      _zaiRefreshToken: "zai-refresh-token",
      _zcodeUser: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
    });

    expect(tokens.accessToken).toBe(PLAN_KEY);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.email).toBe("feavy@example.com");
    expect(tokens.displayName).toBe("Feavy");
    expect(tokens.providerSpecificData).toMatchObject({
      authMethod: "cli_poll",
      plan: "individual-coding-plan",
      username: "Feavy",
      userId: "u-1",
      zcodeJwtToken: "zcode-jwt",
      zaiBusinessToken: "zai-business-jwt",
      individualCodingPlanApiKey: PLAN_KEY,
      teamCodingPlanApiKey: "teamkey.teamsecret",
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

  it("routes Start Plan through ZCode with the official JWT", () => {
    const executor = new DefaultExecutor("glm");
    const creds = {
      accessToken: PLAN_KEY,
      providerSpecificData: { plan: "start-plan", zcodeJwtToken: "zcode-jwt" },
    };

    expect(executor.buildUrl("glm-5.2", true, 0, creds)).toBe(ZCODE_PLAN_URL);
    expect(executor.buildUrl("glm-5.2(max)", true, 0, creds)).toBe(ZCODE_PLAN_URL);
    const headers = executor.buildHeaders(creds, true, ZCODE_PLAN_URL, "glm-5.2", {});
    expect(headers.Authorization).toBe("Bearer zcode-jwt");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(resolveTransport("glm", "openai", creds)).toBeNull();
    expect(resolveTransport("glm", "claude", creds)?.baseUrl).toBe(ZCODE_PLAN_URL);
  });

  it("uses the specialized executor for Start Plan processing", () => {
    expect(new GlmExecutor()).toBeInstanceOf(DefaultExecutor);
  });

  it("adds the ZCode fingerprint and strips Claude API headers", () => {
    zcodeHeaderTest.sessions.clear();
    const headers = applyZcodeHeaders({
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219",
      "x-api-key": "wrong-key",
    }, {
      connectionId: "glm-1",
      providerSpecificData: { zcodeJwtToken: "zcode-jwt" },
    }, "captcha-token");

    expect(headers.Authorization).toBe("Bearer zcode-jwt");
    expect(headers["User-Agent"]).toMatch(/^ZCode\//);
    expect(headers["X-ZCode-App-Version"]).toBeTruthy();
    expect(headers["X-ZCode-Agent"]).toBe("glm");
    expect(headers["X-Aliyun-Captcha-Verify-Param"]).toBe("captcha-token");
    expect(headers["x-session-id"]).toBeTruthy();
    expect(headers["Anthropic-Version"]).toBeUndefined();
    expect(headers["Anthropic-Beta"]).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("maps GLM-5.3 and replaces Claude Code identity for Start Plan", () => {
    const executor = new GlmExecutor();
    const result = executor.transformRequest("glm-5.3", {
      model: "glm-5.3",
      system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }, false, {
      providerSpecificData: { plan: "start-plan", zcodeJwtToken: "zcode-jwt" },
    });

    expect(result.model).toBe("GLM-5.3");
    expect(JSON.stringify(result.system)).toContain("You are ZCode");
    expect(JSON.stringify(result.system)).not.toContain("Claude Code");
  });

  it("keeps ZCode system injection idempotent", () => {
    const first = injectZcodeSystemPrompt({ model: "GLM-5.3", system: [] }, "GLM-5.3");
    expect(injectZcodeSystemPrompt(first, "GLM-5.3").system).toEqual(first.system);
  });

  it("switches between the individual and team Coding Plan keys", () => {
    const executor = new DefaultExecutor("glm");
    const base = {
      authType: "oauth",
      accessToken: PLAN_KEY,
      providerSpecificData: {
        individualCodingPlanApiKey: PLAN_KEY,
        teamCodingPlanApiKey: "teamkey.teamsecret",
      },
    };
    const individual = {
      ...base,
      providerSpecificData: { ...base.providerSpecificData, plan: "individual-coding-plan" },
    };
    const team = {
      ...base,
      providerSpecificData: { ...base.providerSpecificData, plan: "team-coding-plan" },
    };

    expect(executor.buildHeaders(individual, true, ANTHROPIC_URL, "glm-5.3", {})["x-api-key"]).toBe(PLAN_KEY);
    expect(executor.buildHeaders(team, true, ANTHROPIC_URL, "glm-5.3", {})["x-api-key"]).toBe("teamkey.teamsecret");
  });

  it("accepts GLM-5.3 on Start Plan and rejects missing ZCode JWTs", () => {
    const executor = new DefaultExecutor("glm");
    expect(executor.buildUrl("glm-5.3", true, 0, {
      providerSpecificData: { plan: "start-plan", zcodeJwtToken: "zcode-jwt" },
    })).toBe(ZCODE_PLAN_URL);
    expect(() => executor.buildHeaders({ providerSpecificData: { plan: "start-plan" } }, true, ZCODE_PLAN_URL, "glm-5.2", {}))
      .toThrow(/requires zcodeJwtToken/);
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

  it("fetches quota with the selected team plan key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ data: { level: "TEAM", limits: [] } }));

    const usage = await getUsageForProvider({
      provider: "glm",
      accessToken: PLAN_KEY,
      providerSpecificData: { plan: "team-coding-plan", teamCodingPlanApiKey: "teamkey.teamsecret" },
    });

    expect(usage.plan).toBe("Team");
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/monitor/usage/quota/limit",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer teamkey.teamsecret" }) }),
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
