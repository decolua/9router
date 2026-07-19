import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("../../src/lib/oauth/providers.js", () => ({
  exchangeTokens: mocks.exchangeTokens,
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
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

import { GET } from "../../src/app/api/oauth/[provider]/[action]/route.js";
import {
  clearCodexSession,
  clearXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  stopCodexProxy,
  stopXaiProxy,
} from "../../src/lib/oauth/utils/server.js";

describe("OAuth fixed-port callback proxy context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue(true);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "pool",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: true,
    });
    mocks.exchangeTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      providerSpecificData: { authMethod: "oauth" },
    });
    mocks.createProviderConnection.mockImplementation(async (connection) => ({
      id: "connection-1",
      ...connection,
    }));
  });

  afterEach(() => {
    clearCodexSession("codex-state");
    clearXaiSession("xai-state");
    stopCodexProxy();
    stopXaiProxy();
  });

  it.each([
    ["codex", "codex-state", "http://localhost:1455/auth/callback"],
    ["xai", "xai-state", "http://127.0.0.1:56121/callback"],
  ])("uses selected proxy for %s fixed-port callback exchange", async (provider, state, callbackUrl) => {
    const redirectUri = callbackUrl;
    const requestUrl = new URL(`http://localhost/api/oauth/${provider}/start-proxy`);
    requestUrl.searchParams.set("app_port", "20127");
    requestUrl.searchParams.set("state", state);
    requestUrl.searchParams.set("code_verifier", "verifier");
    requestUrl.searchParams.set("redirect_uri", redirectUri);
    requestUrl.searchParams.set("proxyPoolId", "pool-1");

    const startResponse = await GET(new Request(requestUrl), {
      params: Promise.resolve({ provider, action: "start-proxy" }),
    });
    expect(await startResponse.json()).toMatchObject({ success: true, serverSide: true });
    const session = provider === "codex" ? getCodexSessionStatus(state) : getXaiSessionStatus(state);
    expect(session).toMatchObject({ proxyPoolId: "pool-1" });
    expect(session).not.toHaveProperty("proxyOptions");

    const callbackResponse = await fetch(`${callbackUrl}?code=auth-code&state=${state}`);
    expect(callbackResponse.ok).toBe(true);
    expect(mocks.exchangeTokens).toHaveBeenCalledWith(
      provider,
      "auth-code",
      redirectUri,
      "verifier",
      state,
      undefined,
      {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.test:8080",
        connectionNoProxy: "",
        vercelRelayUrl: "",
        strictProxy: true,
      },
    );
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider,
      providerSpecificData: { authMethod: "oauth", proxyPoolId: "pool-1" },
    }));
  });

  it("bypasses proxy environment for direct fixed-port callbacks", async () => {
    const callbackUrl = "http://localhost:1455/auth/callback";
    const requestUrl = new URL("http://localhost/api/oauth/codex/start-proxy");
    requestUrl.searchParams.set("app_port", "20127");
    requestUrl.searchParams.set("state", "codex-state");
    requestUrl.searchParams.set("code_verifier", "verifier");
    requestUrl.searchParams.set("redirect_uri", callbackUrl);

    const startResponse = await GET(new Request(requestUrl), {
      params: Promise.resolve({ provider: "codex", action: "start-proxy" }),
    });
    expect(await startResponse.json()).toMatchObject({ success: true, serverSide: true });

    await fetch(`${callbackUrl}?code=auth-code&state=codex-state`);

    expect(mocks.exchangeTokens.mock.calls[0][6]).toEqual({ disableEnvProxy: true });
    expect(mocks.createProviderConnection.mock.calls[0][0].providerSpecificData).toEqual({
      authMethod: "oauth",
    });
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
  });
});
