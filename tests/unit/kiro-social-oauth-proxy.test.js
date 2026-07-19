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

const proxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "",
  strictProxy: true,
};

function exchangeRequest(proxyPoolId = "pool-1") {
  return new Request("http://localhost/api/oauth/kiro/social-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "social-code",
      codeVerifier: "verifier",
      provider: "google",
      proxyPoolId,
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
    const response = await POST(exchangeRequest());

    expect(response.status).toBe(200);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith("social-code", "verifier", proxyOptions);
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerSpecificData: expect.objectContaining({ proxyPoolId: "pool-1" }),
    }));
  });

  it("uses explicit Direct routing for social token exchange", async () => {
    const response = await POST(exchangeRequest(""));

    expect(response.status).toBe(200);
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith(
      "social-code",
      "verifier",
      { disableEnvProxy: true },
    );
  });
});
