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
    deferListen: false,
    servers: [],
  };

  state.createServer = vi.fn((handler) => {
    const listeners = new Map();
    const server = {
      closeCallback: null,
      handler,
      listening: false,
      listenCallback: null,
      port: null,
      address: () => ({ port: server.port }),
      close: vi.fn((callback) => {
        server.closeCallback = callback || null;
        if (!state.deferClose) queueMicrotask(() => server.finishClose());
      }),
      closeAllConnections: vi.fn(() => server.finishClose()),
      finishClose() {
        server.listening = false;
        const callback = server.closeCallback;
        server.closeCallback = null;
        callback?.();
      },
      listen: vi.fn((port, _host, callback) => {
        server.port = port;
        server.listenCallback = callback;
        if (!state.deferListen) server.finishListen();
        return server;
      }),
      finishListen() {
        if (!server.listenCallback) return;
        server.listening = true;
        const callback = server.listenCallback;
        server.listenCallback = null;
        callback();
      },
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
  registerXaiSession,
  startCodexProxy,
  startXaiProxy,
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
    httpMocks.deferListen = false;
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
    ["codex-state", "poll-state", "abandoned", "fresh", "first", "second", "stop-expired", "orphan"]
      .forEach(clearCodexSession);
    ["xai-state", "abandoned", "fresh", "first", "second", "stop-expired", "orphan"]
      .forEach(clearXaiSession);
    httpMocks.deferClose = false;
    httpMocks.servers.forEach((server) => server.finishClose());
    await stopCodexProxy();
    await stopXaiProxy();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("rejects non-JSON start-proxy requests", async () => {
    const response = await POST(new Request("http://localhost/api/oauth/codex/start-proxy", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ appPort: 20127 }),
    }), {
      params: Promise.resolve({ provider: "codex", action: "start-proxy" }),
    });

    expect(response.status).toBe(415);
    expect(httpMocks.servers).toHaveLength(0);
  });

  it.each([0, -1, 65536, 20127.5, "not-a-port", true, false, [], [20127], {}])(
    "rejects invalid callback app port %s",
    async (appPort) => {
      const response = await startProxy("codex", { appPort });

      expect(response.status).toBe(400);
      expect(httpMocks.servers).toHaveLength(0);
    },
  );

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
    expect(session).toEqual({ status: "pending" });

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

  it("clears the pending session named by stop-proxy", async () => {
    await startProxy("codex", {
      appPort: 20127,
      state: "codex-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    expect(getCodexSessionStatus("codex-state")).not.toBeNull();

    await GET(new Request("http://localhost/api/oauth/codex/stop-proxy?state=codex-state"), {
      params: Promise.resolve({ provider: "codex", action: "stop-proxy" }),
    });

    expect(getCodexSessionStatus("codex-state")).toBeNull();
  });

  it.each([
    ["codex", registerCodexSession, getCodexSessionStatus],
    ["xai", registerXaiSession, getXaiSessionStatus],
  ])("clears all %s sessions when stop-proxy has no state", async (provider, register, getStatus) => {
    register({ state: "orphan", codeVerifier: "secret", redirectUri: "http://callback" });

    await GET(new Request(`http://localhost/api/oauth/${provider}/stop-proxy`), {
      params: Promise.resolve({ provider, action: "stop-proxy" }),
    });

    expect(getStatus("orphan")).toBeNull();
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession],
    ["xai", startXaiProxy, registerXaiSession],
  ])("keeps the %s callback server alive for another pending session", async (_provider, start, register) => {
    await start(20127);
    register({ state: "first", codeVerifier: "first-secret", redirectUri: "http://callback" });
    register({ state: "second", codeVerifier: "second-secret", redirectUri: "http://callback" });
    const server = httpMocks.servers.at(-1);

    await server.request("/callback?code=first-code&state=first");
    expect(server.close).not.toHaveBeenCalled();

    await server.request("/callback?code=second-code&state=second");
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(2);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["codex", startCodexProxy],
    ["xai", startXaiProxy],
  ])("updates the %s legacy fallback app port while reusing its server", async (_provider, start) => {
    await start(20127);
    await start(20128);
    const response = await httpMocks.servers.at(-1).request("/callback?code=legacy-code");

    expect(response.status).toBe(302);
    expect(response.headers.Location).toBe("http://localhost:20128/callback?code=legacy-code");
  });

  it("rejects xAI manual code proxy pool mismatch without exchanging tokens", async () => {
    await startProxy("xai", {
      appPort: 20127,
      state: "xai-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://127.0.0.1:56121/callback",
      proxyPoolId: "pool-1",
    });
    mocks.exchangeTokens.mockClear();

    const response = await POST(new Request("http://localhost/api/oauth/xai/manual-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "manual-code", state: "xai-state", proxyPoolId: "pool-2" }),
    }), {
      params: Promise.resolve({ provider: "xai", action: "manual-code" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("uses state-bound xAI proxy options for manual code exchange", async () => {
    await startProxy("xai", {
      appPort: 20127,
      state: "xai-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://127.0.0.1:56121/callback",
      proxyPoolId: "pool-1",
    });
    mocks.resolveConnectionProxyConfig.mockRejectedValue(new Error("pool changed after authorization"));

    const response = await POST(new Request("http://localhost/api/oauth/xai/manual-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "manual-code", state: "xai-state", proxyPoolId: "pool-1" }),
    }), {
      params: Promise.resolve({ provider: "xai", action: "manual-code" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledTimes(1);
    expect(mocks.exchangeTokens.mock.calls[0][6]).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: true,
    });
  });

  it("expires an unconsumed PKCE session after the proxy lifetime", () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    registerCodexSession({
      state: "codex-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    vi.mocked(Date.now).mockReturnValue(now + 300_001);

    expect(getCodexSessionStatus("codex-state")).toBeNull();
  });

  it("prunes every expired session when registering another session", () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    registerCodexSession({ state: "abandoned", codeVerifier: "secret", redirectUri: "http://codex" });
    registerXaiSession({ state: "abandoned", codeVerifier: "secret", redirectUri: "http://xai" });

    vi.mocked(Date.now).mockReturnValue(now + 300_001);
    registerCodexSession({ state: "fresh", codeVerifier: "secret", redirectUri: "http://codex" });
    registerXaiSession({ state: "fresh", codeVerifier: "secret", redirectUri: "http://xai" });
    vi.mocked(Date.now).mockReturnValue(now);

    expect(getCodexSessionStatus("abandoned")).toBeNull();
    expect(getXaiSessionStatus("abandoned")).toBeNull();
  });

  it("prunes every expired session when reading another state", () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    for (const state of ["first", "second"]) {
      registerCodexSession({ state, codeVerifier: "secret", redirectUri: "http://codex" });
      registerXaiSession({ state, codeVerifier: "secret", redirectUri: "http://xai" });
    }

    vi.mocked(Date.now).mockReturnValue(now + 300_001);
    expect(getCodexSessionStatus("first")).toBeNull();
    expect(getXaiSessionStatus("first")).toBeNull();
    vi.mocked(Date.now).mockReturnValue(now);

    expect(getCodexSessionStatus("second")).toBeNull();
    expect(getXaiSessionStatus("second")).toBeNull();
  });

  it("prunes every expired session when stopping fixed-port proxies", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    registerCodexSession({ state: "stop-expired", codeVerifier: "secret", redirectUri: "http://codex" });
    registerXaiSession({ state: "stop-expired", codeVerifier: "secret", redirectUri: "http://xai" });

    vi.mocked(Date.now).mockReturnValue(now + 300_001);
    await stopCodexProxy();
    await stopXaiProxy();
    vi.mocked(Date.now).mockReturnValue(now);

    expect(getCodexSessionStatus("stop-expired")).toBeNull();
    expect(getXaiSessionStatus("stop-expired")).toBeNull();
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

  it("serializes concurrent starts and a stop during startup", async () => {
    httpMocks.deferListen = true;
    let stopSettled = false;

    const firstStart = startCodexProxy(20127);
    const secondStart = startCodexProxy(20128);
    const stopping = stopCodexProxy().then(() => {
      stopSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    const serverCountBeforeListen = httpMocks.servers.length;
    const stopSettledBeforeListen = stopSettled;
    httpMocks.servers.forEach((server) => server.finishListen());
    await Promise.all([firstStart, secondStart, stopping]);

    expect(serverCountBeforeListen).toBe(1);
    expect(stopSettledBeforeListen).toBe(false);
    expect(httpMocks.servers[0].close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["codex", startCodexProxy, stopCodexProxy],
    ["xai", startXaiProxy, stopXaiProxy],
  ])("does not let stale %s startup timeout close replacement server", async (_provider, start, stop) => {
    vi.useFakeTimers();
    httpMocks.deferListen = true;
    try {
      const starting = start(20127);
      const stopping = stop();
      const firstServer = httpMocks.servers[0];
      firstServer.finishListen();
      await Promise.all([starting, stopping]);

      httpMocks.deferListen = false;
      await vi.advanceTimersByTimeAsync(1_000);
      await start(20128);
      const replacementServer = httpMocks.servers.at(-1);

      await vi.advanceTimersByTimeAsync(299_001);

      expect(replacementServer.close).not.toHaveBeenCalled();
    } finally {
      httpMocks.deferListen = false;
      await stop();
    }
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

  it("bounds shutdown when an active callback never closes", async () => {
    vi.useFakeTimers();
    await startCodexProxy(20127);
    const server = httpMocks.servers[0];
    httpMocks.deferClose = true;
    let settled = false;

    const stopping = stopCodexProxy().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(30_001);
    const settledAtDeadline = settled;
    if (!settled) server.finishClose();
    await stopping;
    vi.useRealTimers();

    expect(settledAtDeadline).toBe(true);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });
});
