import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildSocialLoginUrl: vi.fn(),
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeSocialCode: vi.fn(),
  extractEmailFromJWT: vi.fn(),
  generatePKCE: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/oauth/utils/pkce", () => ({
  generatePKCE: mocks.generatePKCE,
}));

vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: class {
    buildSocialLoginUrl(...args) {
      return mocks.buildSocialLoginUrl(...args);
    }

    exchangeSocialCode(...args) {
      return mocks.exchangeSocialCode(...args);
    }

    extractEmailFromJWT(...args) {
      return mocks.extractEmailFromJWT(...args);
    }
  },
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

import { GET } from "../../src/app/api/oauth/kiro/social-authorize/route.js";
import { POST } from "../../src/app/api/oauth/kiro/social-exchange/route.js";
import { clearAuthorizationFlow } from "../../src/lib/oauth/utils/server.js";

const proxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

function authorizeRequest(proxyPoolId = "pool-1") {
  const url = new URL("http://localhost/api/oauth/kiro/social-authorize");
  url.searchParams.set("provider", "google");
  if (proxyPoolId) url.searchParams.set("proxyPoolId", proxyPoolId);
  return GET(new Request(url));
}

function exchangeRequest(overrides = {}) {
  return new Request("http://localhost/api/oauth/kiro/social-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "social-code",
      state: "state",
      provider: "google",
      ...overrides,
    }),
  });
}

describe("Kiro social OAuth proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue(true);
    mocks.generatePKCE.mockReturnValue({
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      state: "state",
    });
    mocks.buildSocialLoginUrl.mockReturnValue("https://auth.example/social");
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "pool",
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      strictProxy: true,
    });
    mocks.exchangeSocialCode.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      profileArn: "profile-arn",
      expiresIn: 3600,
    });
    mocks.extractEmailFromJWT.mockReturnValue("user@example.com");
    mocks.createProviderConnection.mockImplementation(async (connection) => ({
      id: "connection-1",
      ...connection,
    }));
  });

  it("validates selected pool before returning social authorization URL", async () => {
    const response = await GET(new Request(
      "http://localhost/api/oauth/kiro/social-authorize?provider=google&proxyPoolId=pool-1",
    ));

    expect(response.status).toBe(200);
    expect(mocks.ensureOutboundProxyInitialized).toHaveBeenCalledTimes(1);
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledWith({ proxyPoolId: "pool-1" });
    expect(await response.clone().json()).not.toHaveProperty("codeVerifier");
    expect((await POST(exchangeRequest())).status).toBe(200);
  });

  it("fails closed when selected social OAuth pool is unavailable", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ source: "none" });

    const response = await GET(new Request(
      "http://localhost/api/oauth/kiro/social-authorize?provider=google&proxyPoolId=missing-pool",
    ));

    expect(response.status).toBe(500);
    expect(mocks.buildSocialLoginUrl).not.toHaveBeenCalled();
  });

  it("uses selected pool for social token exchange and persists its id", async () => {
    await authorizeRequest();
    mocks.resolveConnectionProxyConfig.mockRejectedValue(new Error("pool changed"));
    const response = await POST(exchangeRequest());

    expect(response.status).toBe(200);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith("social-code", "verifier", proxyOptions);
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSpecificData: expect.objectContaining({ proxyPoolId: "pool-1" }),
      }),
      expect.objectContaining({ beforePersist: expect.any(Function) }),
    );
  });

  it("uses captured explicit Direct routing for social token exchange", async () => {
    await authorizeRequest("");
    const response = await POST(exchangeRequest());

    expect(response.status).toBe(200);
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith(
      "social-code",
      "verifier",
      { disableEnvProxy: true },
    );
  });

  it("rejects mismatched and already-consumed social state", async () => {
    await authorizeRequest();

    expect((await POST(exchangeRequest({ state: "wrong-state" }))).status).toBe(409);
    expect((await POST(exchangeRequest())).status).toBe(200);
    expect((await POST(exchangeRequest())).status).toBe(409);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledTimes(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("rechecks social flow identity during delayed DB admission", async () => {
    await authorizeRequest();
    let releaseAdmission;
    let persisted = false;
    mocks.createProviderConnection.mockImplementation(async (_data, options) => {
      await new Promise((resolve) => { releaseAdmission = resolve; });
      if (options?.beforePersist?.() === false) throw new Error("OAuth flow was cancelled");
      persisted = true;
      return { id: "late-connection", provider: "kiro" };
    });

    const request = POST(exchangeRequest());
    await vi.waitFor(() => expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1));
    clearAuthorizationFlow("kiro-social", "google", "state");
    releaseAdmission();
    const response = await request;

    expect(response.status).toBe(409);
    expect(persisted).toBe(false);
  });

  it("sanitizes credential-bearing social exchange errors in API and logs", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await authorizeRequest();
    mocks.exchangeSocialCode.mockRejectedValue(new Error(
      "https://user:password@provider.test/token?code=SECRET-CODE&refresh_token=SECRET-REFRESH body=SECRET-BODY",
    ));

    const response = await POST(exchangeRequest());
    const body = await response.json();
    const logged = consoleSpy.mock.calls.flat().map(String).join(" ");

    expect(response.status).toBe(500);
    for (const secret of ["user", "password", "SECRET-CODE", "SECRET-REFRESH", "SECRET-BODY"]) {
      expect(body.error).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });
});
