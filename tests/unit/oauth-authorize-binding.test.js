import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  generateAuthData: vi.fn(),
  pollForToken: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("../../src/lib/oauth/providers.js", () => ({
  exchangeTokens: mocks.exchangeTokens,
  generateAuthData: mocks.generateAuthData,
  getProvider: vi.fn(),
  pollForToken: mocks.pollForToken,
  requestDeviceCode: vi.fn(),
}));
vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

import { GET, POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";

const proxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

function authorize(state, proxyPoolId = "pool-1") {
  mocks.generateAuthData.mockResolvedValueOnce({
    authUrl: `https://auth.example/authorize?state=${state}`,
    state,
    codeVerifier: `${state}-verifier`,
    codeChallenge: `${state}-challenge`,
    redirectUri: "http://localhost:20127/callback",
    flowType: "authorization_code_pkce",
  });
  const url = new URL("http://localhost/api/oauth/claude/authorize");
  url.searchParams.set("redirect_uri", "http://localhost:20127/callback");
  url.searchParams.set("clientId", "original-client");
  if (proxyPoolId) url.searchParams.set("proxyPoolId", proxyPoolId);
  return GET(new Request(url), {
    params: Promise.resolve({ provider: "claude", action: "authorize" }),
  });
}

function exchange(state, overrides = {}) {
  return POST(new Request("http://localhost/api/oauth/claude/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "authorization-code",
      state,
      redirectUri: "http://attacker.test/callback",
      codeVerifier: "attacker-verifier",
      proxyPoolId: "attacker-pool",
      meta: { clientId: "attacker-client" },
      ...overrides,
    }),
  }), {
    params: Promise.resolve({ provider: "claude", action: "exchange" }),
  });
}

describe("dynamic OAuth server-owned authorization records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue(true);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ source: "pool", ...proxyOptions });
    mocks.exchangeTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      providerSpecificData: {},
    });
    mocks.createProviderConnection.mockImplementation(async (connection) => ({
      id: "connection-1",
      ...connection,
    }));
  });

  it("keeps PKCE verifier and proxy context out of authorize response", async () => {
    const response = await authorize("binding-response");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ authUrl: expect.any(String), state: "binding-response" });
    expect(body).not.toHaveProperty("codeVerifier");
    expect(body).not.toHaveProperty("codeChallenge");
    expect(body).not.toHaveProperty("redirectUri");
    expect((await exchange("binding-response")).status).toBe(200);
  });

  it("exchanges only with captured verifier, redirect, metadata, and proxy", async () => {
    await authorize("binding-exchange");
    mocks.resolveConnectionProxyConfig.mockRejectedValue(new Error("pool changed"));

    const response = await exchange("binding-exchange");

    expect(response.status).toBe(200);
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledTimes(1);
    expect(mocks.exchangeTokens).toHaveBeenCalledWith(
      "claude",
      "authorization-code",
      "http://localhost:20127/callback",
      "binding-exchange-verifier",
      "binding-exchange",
      { clientId: "original-client" },
      proxyOptions,
    );
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerSpecificData: expect.objectContaining({ proxyPoolId: "pool-1" }),
    }));
  });

  it("consumes authorization state once", async () => {
    await authorize("binding-once");

    const first = await exchange("binding-once");
    const second = await exchange("binding-once");

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or mismatched state before exchange", async () => {
    await authorize("binding-state");

    expect((await exchange("wrong-state")).status).toBe(409);
    expect((await exchange("", { state: "" })).status).toBe(400);
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
    expect((await exchange("binding-state")).status).toBe(200);
  });

  it("refuses authorization admission at capacity without evicting active state", async () => {
    for (let index = 0; index < 128; index += 1) {
      expect((await authorize(`binding-capacity-${index}`)).status).toBe(200);
    }

    expect((await authorize("binding-capacity-rejected")).status).toBe(503);
    expect((await exchange("binding-capacity-0")).status).toBe(200);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
  });

  it("sanitizes credential-bearing exchange errors in API and logs", async () => {
    const secrets = ["log-user", "log-password", "LOG-CODE", "LOG-ACCESS", "LOG-REFRESH", "LOG-STATE"];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await authorize("binding-sanitized");
    mocks.exchangeTokens.mockRejectedValue(new Error(
      "provider body https://log-user:log-password@provider.test/callback" +
      "?code=LOG-CODE&access_token=LOG-ACCESS&refresh_token=LOG-REFRESH#LOG-STATE",
    ));

    const response = await exchange("binding-sanitized");
    const body = await response.json();
    const logged = consoleSpy.mock.calls.flat().map(String).join(" ");

    expect(response.status).toBe(500);
    expect(body.error.length).toBeLessThanOrEqual(240);
    for (const secret of secrets) {
      expect(body.error).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });

  it("sanitizes provider error descriptions returned by device polling", async () => {
    const secrets = ["poll-user", "poll-password", "POLL-CODE", "POLL-REFRESH"];
    mocks.pollForToken.mockResolvedValue({
      success: false,
      error: "access_denied",
      errorDescription: "https://poll-user:poll-password@provider.test/callback" +
        "?code=POLL-CODE&refresh_token=POLL-REFRESH",
    });

    const response = await POST(new Request("http://localhost/api/oauth/github/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: "device-code" }),
    }), {
      params: Promise.resolve({ provider: "github", action: "poll" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    for (const secret of secrets) expect(body.errorDescription).not.toContain(secret);
  });

  it("sanitizes unknown provider error codes returned by device polling", async () => {
    const secrets = ["error-user", "error-password", "ERROR-CODE"];
    mocks.pollForToken.mockResolvedValue({
      success: false,
      error: "https://error-user:error-password@provider.test/callback?code=ERROR-CODE",
    });

    const response = await POST(new Request("http://localhost/api/oauth/github/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: "device-code" }),
    }), {
      params: Promise.resolve({ provider: "github", action: "poll" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    for (const secret of secrets) expect(body.error).not.toContain(secret);
  });
});
