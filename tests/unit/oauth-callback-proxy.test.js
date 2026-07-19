import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

const httpMocks = vi.hoisted(() => {
  const state = {
    deferClose: false,
    servers: [],
  };

  state.createServer = vi.fn((handler) => {
    const listeners = new Map();
    const server = {
      closeCallback: null,
      handler,
      listening: false,
      port: null,
      address: () => ({ port: server.port }),
      close: vi.fn((callback) => {
        server.closeCallback = callback || null;
        if (!state.deferClose) queueMicrotask(() => server.finishClose());
      }),
      finishClose() {
        server.listening = false;
        const callback = server.closeCallback;
        server.closeCallback = null;
        callback?.();
      },
      listen: vi.fn((port, _host, callback) => {
        server.port = port;
        server.listening = true;
        callback();
        return server;
      }),
      on: vi.fn((event, callback) => {
        listeners.set(event, callback);
        return server;
      }),
      async request(url) {
        const response = {
          body: "",
          headers: {},
          status: 0,
          end(body = "") {
            response.body = body;
          },
          writeHead(status, headers = {}) {
            response.status = status;
            response.headers = headers;
          },
        };
        await handler({ url }, response);
        return {
          ...response,
          ok: response.status >= 200 && response.status < 300,
        };
      },
    };
    state.servers.push(server);
    return server;
  });

  return state;
});

vi.mock("http", () => ({ default: { createServer: httpMocks.createServer } }));
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

import { GET, POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";
import {
  clearCodexSession,
  clearXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  registerCodexSession,
  startCodexProxy,
  stopCodexProxy,
  stopXaiProxy,
} from "../../src/lib/oauth/utils/server.js";

function startProxy(provider, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/start-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), {
    params: Promise.resolve({ provider, action: "start-proxy" }),
  });
}

describe("OAuth fixed-port callback proxy context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpMocks.deferClose = false;
    httpMocks.servers.length = 0;
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
      email: "user@example.com",
      providerSpecificData: { authMethod: "oauth" },
    });
    mocks.createProviderConnection.mockImplementation(async (connection) => ({
      id: "connection-1",
      ...connection,
    }));
  });

  afterEach(async () => {
    clearCodexSession("codex-state");
    clearXaiSession("xai-state");
    clearCodexSession("poll-state");
    httpMocks.deferClose = false;
    httpMocks.servers.forEach((server) => server.finishClose());
    await stopCodexProxy();
    await stopXaiProxy();
  });

  it("registers PKCE sessions only through POST JSON", async () => {
    const queryUrl = new URL("http://localhost/api/oauth/codex/start-proxy");
    queryUrl.searchParams.set("app_port", "20127");
    queryUrl.searchParams.set("state", "codex-state");
    queryUrl.searchParams.set("code_verifier", "secret-verifier");
    queryUrl.searchParams.set("redirect_uri", "http://localhost:1455/auth/callback");

    const getResponse = await GET(new Request(queryUrl), {
      params: Promise.resolve({ provider: "codex", action: "start-proxy" }),
    });
    expect(getResponse.status).toBe(400);
    expect(httpMocks.servers).toHaveLength(0);

    const postResponse = await startProxy("codex", {
      appPort: "20127",
      state: "codex-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    expect(await postResponse.json()).toMatchObject({ success: true, serverSide: true });
    expect(httpMocks.servers).toHaveLength(1);
  });

  it.each([
    ["codex", "codex-state", "http://localhost:1455/auth/callback"],
    ["xai", "xai-state", "http://127.0.0.1:56121/callback"],
  ])("uses selected proxy for %s fixed-port callback exchange", async (provider, state, callbackUrl) => {
    const redirectUri = callbackUrl;
    const startResponse = await startProxy(provider, {
      appPort: "20127",
      state,
      codeVerifier: "verifier",
      redirectUri,
      proxyPoolId: "pool-1",
    });
    expect(await startResponse.json()).toMatchObject({ success: true, serverSide: true });
    const session = provider === "codex" ? getCodexSessionStatus(state) : getXaiSessionStatus(state);
    expect(session).toMatchObject({ proxyPoolId: "pool-1" });
    expect(session).not.toHaveProperty("proxyOptions");

    const callbackResponse = await httpMocks.servers.at(-1).request(
      `${new URL(callbackUrl).pathname}?code=auth-code&state=${state}`,
    );
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
    const startResponse = await startProxy("codex", {
      appPort: "20127",
      state: "codex-state",
      codeVerifier: "verifier",
      redirectUri: callbackUrl,
    });
    expect(await startResponse.json()).toMatchObject({ success: true, serverSide: true });

    await httpMocks.servers.at(-1).request("/auth/callback?code=auth-code&state=codex-state");

    expect(mocks.exchangeTokens.mock.calls[0][6]).toEqual({ disableEnvProxy: true });
    expect(mocks.createProviderConnection.mock.calls[0][0].providerSpecificData).toEqual({
      authMethod: "oauth",
    });
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
  });

  it("returns only allowlisted fields from completed poll status", async () => {
    await startCodexProxy(20127);
    registerCodexSession({
      state: "poll-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
      proxyPoolId: "pool-1",
      proxyOptions: { connectionProxyEnabled: true },
    });
    await httpMocks.servers.at(-1).request("/auth/callback?code=auth-code&state=poll-state");

    const response = await GET(new Request("http://localhost/api/oauth/codex/poll-status?state=poll-state"), {
      params: Promise.resolve({ provider: "codex", action: "poll-status" }),
    });

    expect(await response.json()).toEqual({
      status: "done",
      connectionId: "connection-1",
      email: "user@example.com",
    });
  });

  it("does not start a replacement until the old fixed-port server closes", async () => {
    await startCodexProxy(20127);
    const oldServer = httpMocks.servers[0];
    httpMocks.deferClose = true;

    const stopping = stopCodexProxy();
    const restarting = startCodexProxy(20128);
    await new Promise((resolve) => setImmediate(resolve));

    expect(httpMocks.servers).toHaveLength(1);
    oldServer.finishClose();
    await stopping;
    await restarting;
    expect(httpMocks.servers).toHaveLength(2);

    await startCodexProxy(20129);
    expect(httpMocks.servers).toHaveLength(2);
  });

  it("waits for server close before stop-proxy responds", async () => {
    await startCodexProxy(20127);
    const server = httpMocks.servers[0];
    httpMocks.deferClose = true;
    let settled = false;

    const responsePromise = GET(new Request("http://localhost/api/oauth/codex/stop-proxy"), {
      params: Promise.resolve({ provider: "codex", action: "stop-proxy" }),
    }).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    server.finishClose();
    expect(await (await responsePromise).json()).toEqual({ success: true });
  });
});
