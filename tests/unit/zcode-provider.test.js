import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hasActiveCodingPlan,
  isTeamPlanEntitled,
  selectDefaultProject,
  resolveZcodeAuth,
  ZCODE_START_BASE,
  ZCODE_START_CLIENT_VERSION,
  ZCODE_START_MODELS,
} from "open-sse/services/zcodePlan.js";
import { ZCODE_SYSTEM_PROMPTS } from "open-sse/services/zcodePrompt.js";
import { buildZcodeBalanceRequest, parseZcodeStartPlanBalance } from "open-sse/services/usage/zcode.js";
import { getRemainingPercentage, parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking, mapEffortToSupportedLevel } from "open-sse/translator/concerns/thinkingUnified.js";
import zcodeRegistry from "open-sse/providers/registry/zcode.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH } from "open-sse/providers/index.js";
import { getExecutor } from "open-sse/executors/index.js";
import zcodeOAuth from "@/lib/oauth/providers/zcode.js";
import { generateAuthData, getProvider, pollForToken, requestDeviceCode } from "@/lib/oauth/providers/index.js";
import { ZCodeExecutor, normalizeStartPlanResponse } from "open-sse/executors/zcode.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("zcode registry", () => {
  it("exposes an OAuth provider with a default GLM model", () => {
    expect(zcodeRegistry.id).toBe("zcode");
    expect(zcodeRegistry.category).toBe("oauth");
    expect(zcodeRegistry.hasOAuth).toBe(true);
    expect(zcodeRegistry.oauth.cliInitUrl).toContain("/api/v1/oauth/cli/init");
    expect(zcodeRegistry.models[0].id).toBe("GLM-5.3-Flash");
  });

  it("is wired into the provider registry, executor map, and OAuth flow", async () => {
    expect(PROVIDERS.zcode?.format).toBe("claude");
    expect(PROVIDER_MODELS.zc.some((model) => model.id === "GLM-5.3-Flash")).toBe(true);
    expect(PROVIDER_OAUTH.zcode?.providerId).toBe("zai");
    expect(getExecutor("zcode")).toBeInstanceOf(ZCodeExecutor);
    expect(getProvider("zcode")).toBeTruthy();

    const auth = await generateAuthData("zcode", "http://localhost:20128/callback");
    expect(auth.flowType).toBe("device_code");
    expect(auth.authUrl).toBeNull();
  });

  it("starts the device login through the ZCode CLI init endpoint", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options = {}) => {
        calls.push({ url: String(url), headers: options.headers, body: options.body });
        if (String(url).includes("/api/v1/oauth/cli/init")) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: {
                flow_id: "flow-1",
                authorize_url: "https://zcode.z.ai/login?flow=flow-1",
                poll_interval_sec: 3,
                expires_at: Math.floor(Date.now() / 1000) + 300,
              },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected ${url}`);
      })
    );

    const device = await requestDeviceCode("zcode");
    expect(device.device_code).toBe("flow-1");
    expect(device.verification_uri).toBe("https://zcode.z.ai/login?flow=flow-1");
    expect(device.interval).toBe(3);
    expect(device._zcodePollToken).toMatch(/^[a-f0-9]{64}$/);
    expect(device._zcodeFamily).toBe("zai");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${device._zcodePollToken}`);
    expect(JSON.parse(calls[0].body)).toEqual({ provider: "zai" });
  });

  it("polls the device login into a zcode JWT plus business token", async () => {
    let pollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const target = String(url);
        if (target.includes("/api/v1/oauth/cli/poll/flow-1")) {
          pollCount += 1;
          if (pollCount === 1) {
            return new Response(JSON.stringify({ code: 0, data: { status: "pending" } }), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              code: 0,
              data: {
                status: "ready",
                token: "zcode-jwt",
                user: { user_id: "u-1", name: "User", email: "user@example.com" },
                zai: { access_token: "zai-business-token" },
              },
            }),
            { status: 200 }
          );
        }
        if (target.includes("/api/biz/subscription/list")) {
          return new Response(JSON.stringify({ code: 200, success: true, data: [] }), { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      })
    );

    const extraData = { _zcodePollToken: "poll-token", _zcodeFamily: "zai" };
    const pending = await pollForToken("zcode", "flow-1", null, extraData);
    expect(pending.success).toBe(false);
    expect(pending.pending).toBe(true);

    const ready = await pollForToken("zcode", "flow-1", null, extraData);
    expect(ready.success).toBe(true);
    expect(ready.tokens.accessToken).toBe("zai-business-token");
    expect(ready.tokens.providerSpecificData.zcodeJwtToken).toBe("zcode-jwt");
    expect(ready.tokens.providerSpecificData.oauthAccessToken).toBe("zai-business-token");
    expect(ready.tokens.providerSpecificData.family).toBe("zai");
    expect(ready.tokens.providerSpecificData.zcodePlan).toBe("start-plan");
  });

  it("maps ZCode device tokens into connection metadata", () => {
    const mapped = zcodeOAuth.mapTokens({
      access_token: "zai-business-token",
      _zcodeJwtToken: "zcode-jwt",
      _zcodeFamily: "zai",
      _zcodeUser: { user_id: "u-1", name: "User", email: "user@example.com" },
    });
    expect(mapped.accessToken).toBe("zai-business-token");
    expect(mapped.displayName).toBe("User");
    expect(mapped.providerSpecificData).toMatchObject({
      authMethod: "oauth",
      family: "zai",
      zcodeJwtToken: "zcode-jwt",
      oauthAccessToken: "zai-business-token",
      userId: "u-1",
    });
  });
});

describe("zcode plan selection", () => {
  it("detects an active personal coding plan", () => {
    expect(
      hasActiveCodingPlan([
        { productId: "zcode-coding-plan", status: "VALID", inCurrentPeriod: true },
      ])
    ).toBe(true);
    expect(
      hasActiveCodingPlan([
        { productId: "zcode-coding-plan", status: "EXPIRED", inCurrentPeriod: true },
      ])
    ).toBe(false);
    expect(hasActiveCodingPlan([])).toBe(false);
  });

  it("detects team plan entitlement", () => {
    expect(
      isTeamPlanEntitled({ hasSubscription: true, status: "EFFECTIVE", memberGrantStatus: "VALID" })
    ).toBe(true);
    expect(isTeamPlanEntitled({ hasSubscription: true, status: "EXPIRED" })).toBe(false);
  });

  it("prefers default personal org/project and filters team projects", () => {
    const orgs = [
      {
        organizationId: "org-1",
        organizationName: "默认机构(1)",
        projects: [
          { projectId: "team-project", projectName: "团队项目", projectType: "2" },
          { projectId: "proj-1", projectName: "默认项目(1)" },
        ],
      },
    ];
    expect(selectDefaultProject(orgs)).toEqual({
      organizationId: "org-1",
      projectId: "proj-1",
    });
  });

  it("mints a project access token for an active coding plan", async () => {
    const requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options = {}) => {
        const target = String(url);
        const method = options.method || "GET";
        requests.push({ target, method, body: options.body });
        if (target.includes("/api/biz/subscription/list")) {
          return new Response(
            JSON.stringify({
              code: 200,
              success: true,
              data: [{ productId: "zcode-coding-plan", status: "VALID", inCurrentPeriod: true }],
            }),
            { status: 200 }
          );
        }
        if (target.includes("/customer/getCustomerInfo")) {
          return new Response(
            JSON.stringify({
              code: 200,
              success: true,
              data: {
                organizations: [
                  {
                    organizationId: "org-1",
                    organizationName: "默认机构(1)",
                    projects: [{ projectId: "proj-1", projectName: "默认项目(1)", projectType: 0 }],
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (target.includes("/api_keys") && method === "GET") {
          return new Response(JSON.stringify({ code: 200, success: true, data: [] }), { status: 200 });
        }
        if (target.endsWith("/api_keys") && method === "POST") {
          return new Response(
            JSON.stringify({ code: 200, success: true, data: { apiKey: "key-id", name: "zcode-api-key", keyType: 1 } }),
            { status: 200 }
          );
        }
        if (target.endsWith("/access_tokens") && method === "POST") {
          return new Response(
            JSON.stringify({
              code: 200,
              success: true,
              data: {
                enabled: true,
                accessToken: "project-token",
                expiresAt: Math.floor(Date.now() / 1000) + 3600,
              },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected ${method} ${target}`);
      })
    );

    const resolved = await resolveZcodeAuth(
      {
        connectionId: "conn-individual",
        accessToken: "business-token",
        providerSpecificData: { family: "zai", zcodeJwtToken: "zcode-jwt" },
      },
      { force: true }
    );

    expect(resolved.planKind).toBe("individual-coding-plan");
    expect(resolved.lane).toBe("project");
    expect(resolved.clientVersion).toBe("3.17.1");
    expect(resolved.baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(resolved.apiKey).toBe("project-token");
    expect(resolved.persist.zcodeProjectToken).toBe("project-token");
    expect(resolved.persist.zcodeOrganizationId).toBe("org-1");

    const keyCreate = requests.find((request) => request.method === "POST" && request.target.endsWith("/api_keys"));
    expect(JSON.parse(keyCreate.body)).toMatchObject({ name: "zcode-api-key", usageScene: 1 });
  });

  it("resolves a start-plan JWT when no coding subscription exists", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/biz/subscription/list")) {
        return new Response(JSON.stringify({ code: 200, success: true, data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveZcodeAuth(
      {
        connectionId: "conn-start",
        accessToken: "business-token",
        providerSpecificData: { family: "zai", zcodeJwtToken: "zcode-jwt" },
      },
      { force: true }
    );

    expect(resolved.planKind).toBe("start-plan");
    expect(resolved.lane).toBe("start");
    expect(resolved.clientVersion).toBe(ZCODE_START_CLIENT_VERSION);
    expect(resolved.baseUrl).toBe(ZCODE_START_BASE);
    expect(resolved.apiKey).toBe("zcode-jwt");
    expect(resolved.models).toEqual(ZCODE_START_MODELS);
  });
});

describe("zcode start plan quota", () => {
  const balanceEnvelope = {
    code: 0,
    msg: "",
    data: {
      server_time: 1793400132,
      plans: [
        {
          user_plan_id: "upl_1",
          plan_id: "zcode-v3-start-plan-1030-wk",
          name: "ZCODE WEEKEND BUILD",
          status: "active",
          starts_at: 1793358902,
          ends_at: 1793581200,
          entitlements: [{ entitlement_id: "ent-1", show_name: "GLM-5.3-Flash", meter: "model_usage", unit_type: "token", grant_units: 500000000, period: "one_time" }],
        },
      ],
      balances: [
        {
          user_plan_id: "upl_1",
          plan_id: "zcode-v3-start-plan-1030-wk",
          entitlement_id: "ent-1",
          show_name: "GLM-5.3-Flash",
          meter: "model_usage",
          unit_type: "token",
          capabilities: ["model:glm-5.3-flash"],
          total_units: 500000000,
          used_units: 769128,
          remaining_units: 499230872,
          expires_at: 1793581200,
        },
      ],
    },
  };

  it("normalizes start-plan balances into dashboard quotas", () => {
    const parsed = parseZcodeStartPlanBalance(balanceEnvelope);
    expect(parsed.plan).toBe("ZCODE WEEKEND BUILD");
    expect(parsed.quotas["GLM-5.3-Flash"]).toMatchObject({
      used: 769128,
      total: 500000000,
      resetAt: new Date(1793581200 * 1000).toISOString(),
      expiresAt: new Date(1793581200 * 1000).toISOString(),
      percentageIsUsed: false,
      recurring: false,
      absoluteReset: true,
    });
    expect(parsed.quotas["GLM-5.3-Flash"].percentage).toBeCloseTo(
      ((500000000 - 769128) / 500000000) * 100,
      6
    );

    const rows = parseQuotaData("zcode", parsed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "GLM-5.3-Flash",
      used: 769128,
      total: 500000000,
      recurring: false,
      absoluteReset: true,
    });
    expect(rows[0].expiresAt).toBe(new Date(1793581200 * 1000).toISOString());
  });

  it("builds the balance request with the device identity header", () => {
    const request = buildZcodeBalanceRequest({
      id: "conn-1",
      providerSpecificData: { userId: "user-1", zcodeJwtToken: "zcode-jwt" },
    });
    expect(request.url).toContain("/api/v1/zcode-plan/billing/balance");
    expect(request.url).toContain("app_version=");
    expect(request.headers.Authorization).toBe("Bearer zcode-jwt");
    expect(request.headers["X-Device-Mid"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(request.headers["X-ZCode-App-Version"]).toBe("3.16.3");

    expect(buildZcodeBalanceRequest({ id: "conn-2", providerSpecificData: {} })).toBeNull();
  });

  it("keeps one decimal when a nearly full quota would round to 100%", () => {
    const percentage = ((500000000 - 769128) / 500000000) * 100;
    expect(getRemainingPercentage({ percentage, percentageIsUsed: false })).toBe(99.8);
    expect(getRemainingPercentage({ used: 50, total: 100 })).toBe(50);
    expect(getRemainingPercentage({ percentage: 100, percentageIsUsed: false })).toBe(100);
  });
});

describe("zcode thinking + vision", () => {
  it("advertises vision and per-model effort tiers", () => {
    expect(getCapabilitiesForModel("zcode", "GLM-5.3-Flash")).toMatchObject({
      vision: true,
      videoInput: true,
      pdf: true,
      thinkingFormat: "zai-anthropic",
      thinkingCanDisable: false,
    });
    expect(getCapabilitiesForModel("zc", "GLM-5.3-Flash").vision).toBe(true);
    expect(getThinkingLevels("zcode", "GLM-5.3-Flash")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("zc", "GLM-5.3-Flash")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("zcode", "GLM-5.3")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("zcode", "GLM-5.2")).toEqual(["none", "high", "max"]);
  });

  it("maps unsupported effort levels to the nearest supported tier", () => {
    expect(mapEffortToSupportedLevel("xhigh", ["low", "high", "max"])).toBe("max");
    expect(mapEffortToSupportedLevel("medium", ["low", "high", "max"])).toBe("high");
    expect(mapEffortToSupportedLevel("minimal", ["low", "high", "max"])).toBe("low");
    expect(mapEffortToSupportedLevel("max", ["low", "high"])).toBe("high");
    expect(mapEffortToSupportedLevel("xhigh", ["low", "high"])).toBe("high");
  });

  it("applies the GLM-5.3 Anthropic thinking wire", () => {
    const xhigh = { messages: [] };
    applyThinking("claude", "GLM-5.3-Flash", xhigh, "zcode", { mode: "level", level: "xhigh" });
    expect(xhigh.thinking).toEqual({ type: "enabled" });
    expect(xhigh.output_config).toEqual({ effort: "max" });

    const none = { messages: [] };
    applyThinking("claude", "GLM-5.3", none, "zcode", { mode: "none" });
    expect(none.thinking).toEqual({ type: "enabled" });
    expect(none.output_config).toEqual({ effort: "low" });
  });

  it("lets GLM-5.2 stop thinking but maps low to high", () => {
    const none = { messages: [] };
    applyThinking("claude", "GLM-5.2", none, "zcode", { mode: "none" });
    expect(none.thinking).toEqual({ type: "disabled" });
    expect(none.output_config).toBeUndefined();

    const minimal = { messages: [] };
    applyThinking("claude", "GLM-5.2", minimal, "zcode", { mode: "level", level: "minimal" });
    expect(minimal.thinking).toEqual({ type: "disabled" });

    const low = { messages: [] };
    applyThinking("claude", "GLM-5.2", low, "zcode", { mode: "level", level: "low" });
    expect(low.thinking).toEqual({ type: "enabled" });
    expect(low.output_config).toEqual({ effort: "high" });
  });

  it("forces streaming upstream for non-stream clients", () => {
    expect(PROVIDERS.zcode?.forceStream).toBe(true);
  });
});

describe("zcode executor", () => {
  it("posts to the plan endpoint with x-api-key auth", () => {
    const executor = new ZCodeExecutor();
    const credentials = {
      providerSpecificData: {
        __zcodeAuth: {
          lane: "project",
          clientVersion: "3.17.1",
          baseUrl: "https://api.z.ai/api/anthropic",
          apiKey: "project-token",
          headers: { "Bigmodel-Organization": "org-1", "Bigmodel-Project": "proj-1" },
        },
      },
    };

    expect(executor.buildUrl("GLM-5.3-Flash", true, 0, credentials)).toBe(
      "https://api.z.ai/api/anthropic/v1/messages"
    );

    const headers = executor.buildHeaders(credentials, true, "", "GLM-5.3-Flash");
    expect(headers["x-api-key"]).toBe("project-token");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Bigmodel-Organization"]).toBe("org-1");
    expect(headers.Authorization).toBe("Bearer project-token");
    expect(headers["x-zcode-app-version"]).toBe("3.17.1");
  });

  it("uses Bearer-only 3.16.3 auth and injects the ZCode system prompt for the start lane", () => {
    const executor = new ZCodeExecutor();
    const credentials = {
      providerSpecificData: {
        __zcodeAuth: {
          lane: "start",
          clientVersion: ZCODE_START_CLIENT_VERSION,
          baseUrl: ZCODE_START_BASE,
          apiKey: "zcode-jwt",
          headers: {},
        },
      },
    };

    const headers = executor.buildHeaders(credentials, true, "", "GLM-5.3-Flash");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer zcode-jwt");
    expect(headers["x-zcode-app-version"]).toBe(ZCODE_START_CLIENT_VERSION);
    expect(headers["User-Agent"]).toBe(`ZCode/${ZCODE_START_CLIENT_VERSION}`);

    const withUserSystem = executor.transformRequest(
      "GLM-5.3-Flash",
      { system: "Be concise.", messages: [{ role: "user", content: "hi" }] },
      true,
      credentials
    );
    expect(withUserSystem.system[0]).toEqual({ type: "text", text: ZCODE_SYSTEM_PROMPTS[0] });
    expect(withUserSystem.system[1]).toEqual({ type: "text", text: ZCODE_SYSTEM_PROMPTS[1] });
    expect(withUserSystem.system[2]).toEqual({ type: "text", text: "Be concise." });

    const alreadyInjected = executor.transformRequest(
      "GLM-5.3-Flash",
      withUserSystem,
      true,
      credentials
    );
    expect(alreadyInjected.system).toHaveLength(3);
  });

  it("keeps the translated thinking shape on the start lane", () => {
    const executor = new ZCodeExecutor();
    const credentials = {
      providerSpecificData: {
        __zcodeAuth: { lane: "start", clientVersion: ZCODE_START_CLIENT_VERSION, baseUrl: ZCODE_START_BASE, apiKey: "zcode-jwt", headers: {} },
      },
    };
    const transformed = executor.transformRequest(
      "GLM-5.3-Flash",
      { thinking: { type: "enabled" }, output_config: { effort: "low" }, messages: [{ role: "user", content: "hi" }] },
      true,
      credentials
    );
    expect(transformed.thinking).toEqual({ type: "enabled" });
    expect(transformed.output_config).toEqual({ effort: "low" });
  });

  it("folds system-role messages into the top-level system prompt", () => {
    const executor = new ZCodeExecutor();
    const credentials = {
      providerSpecificData: {
        userId: "fa0f00fc-de8b-4d73-9088-dfa7c8a96afa",
        __zcodeAuth: { lane: "start", clientVersion: ZCODE_START_CLIENT_VERSION, baseUrl: ZCODE_START_BASE, apiKey: "zcode-jwt", headers: {} },
      },
    };
    const transformed = executor.transformRequest(
      "GLM-5.3-Flash",
      {
        system: "You are Claude Code.",
        output_config: { effort: "high" },
        messages: [
          { role: "user", content: "hi" },
          { role: "system", content: [{ type: "text", text: "sandbox instructions" }] },
        ],
      },
      true,
      credentials
    );
    expect(transformed.messages).toHaveLength(1);
    expect(transformed.messages[0].role).toBe("user");
    expect(transformed.system).toHaveLength(3);
    expect(transformed.system[0].text).toBe(ZCODE_SYSTEM_PROMPTS[0]);
    expect(transformed.system[1].text).toBe(ZCODE_SYSTEM_PROMPTS[1]);
    expect(transformed.system[2].text).toContain("You are Claude Code.");
    expect(transformed.system[2].text).toContain("sandbox instructions");
    expect(transformed.metadata).toEqual({ user_id: "fa0f00fc-de8b-4d73-9088-dfa7c8a96afa" });
    expect(transformed.output_config).toEqual({ effort: "high" });
  });

  it("keeps at most three system blocks when the client sends many", () => {
    const executor = new ZCodeExecutor();
    const credentials = {
      providerSpecificData: {
        __zcodeAuth: { lane: "start", clientVersion: ZCODE_START_CLIENT_VERSION, baseUrl: ZCODE_START_BASE, apiKey: "zcode-jwt", headers: {} },
      },
    };
    const transformed = executor.transformRequest(
      "GLM-5.3-Flash",
      {
        system: [
          { type: "text", text: "aaa" },
          { type: "text", text: "bbb" },
          { type: "text", text: "ccc" },
          { type: "text", text: "ddd" },
        ],
        messages: [{ role: "user", content: "hi" }],
      },
      true,
      credentials
    );
    expect(transformed.system).toHaveLength(3);
    expect(transformed.system[2].text).toBe("aaa\n\nbbb\n\nccc\n\nddd");
  });

  it("sends a UUIDv7 x-query-id like the desktop client", () => {
    const executor = new ZCodeExecutor();
    const headers = executor.buildHeaders(
      {
        providerSpecificData: {
          __zcodeAuth: { lane: "start", clientVersion: ZCODE_START_CLIENT_VERSION, baseUrl: ZCODE_START_BASE, apiKey: "zcode-jwt", headers: {} },
        },
      },
      true,
      "",
      "GLM-5.3-Flash"
    );
    expect(headers["x-query-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("turns a 200 business-error envelope from the start lane into an error response", async () => {
    const response = new Response(JSON.stringify({ code: 1005, msg: "exceed quota limit" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const normalized = await normalizeStartPlanResponse(response);
    expect(normalized.status).toBe(429);
    expect(await normalized.text()).toContain("exceed quota limit");
  });
});
