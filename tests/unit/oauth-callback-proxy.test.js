import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
  requestDeviceCode: vi.fn(),
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
  generateAuthData: mocks.generateAuthData,
  getProvider: mocks.getProvider,
  pollForToken: mocks.pollForToken,
  requestDeviceCode: mocks.requestDeviceCode,
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
import { proxyOptionsForPool } from "../../src/lib/oauth/proxyOptions.js";
import {
  clearCodexSession,
  clearCodexSessions,
  clearDeviceAuthorizationFlows,
  clearXaiSession,
  clearXaiSessions,
  getCodexSessionStatus,
  getXaiSessionStatus,
  registerCodexSession,
  registerXaiSession,
  startCodexProxy,
  startXaiProxy,
  stopCodexProxy,
  stopXaiProxy,
} from "../../src/lib/oauth/utils/server.js";

async function startProxy(provider, body) {
  if (body.state && body.codeVerifier && body.redirectUri) {
    const context = {
      state: body.state,
      codeVerifier: body.codeVerifier,
      redirectUri: body.redirectUri,
      proxyPoolId: body.proxyPoolId || "",
      proxyOptions: await proxyOptionsForPool(body.proxyPoolId),
    };
    if (provider === "xai") registerXaiSession(context);
    else registerCodexSession(context);
  }
  return POST(new Request(`http://localhost/api/oauth/${provider}/start-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appPort: body.appPort, state: body.state }),
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
    mocks.getProvider.mockReturnValue({ flowType: "device_code" });
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://auth.example/authorize",
      state: "codex-state",
      codeVerifier: "secret-verifier",
      codeChallenge: "challenge",
      redirectUri: "http://localhost:1455/auth/callback",
      flowType: "authorization_code_pkce",
    });
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "device-code",
      user_code: "CODE",
      verification_uri: "https://provider.test/device",
      interval: 1,
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "pool",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: true,
      disableEnvProxy: true,
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
    clearCodexSessions();
    clearDeviceAuthorizationFlows();
    clearXaiSessions();
    httpMocks.deferClose = false;
    httpMocks.servers.forEach((server) => server.finishClose());
    await stopCodexProxy({ force: true });
    await stopXaiProxy({ force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers fixed-port PKCE server-side during authorize", async () => {
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

    const authorizeResponse = await GET(new Request(
      "http://localhost/api/oauth/codex/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
    ), {
      params: Promise.resolve({ provider: "codex", action: "authorize" }),
    });
    expect(await authorizeResponse.json()).not.toHaveProperty("codeVerifier");

    const postResponse = await startProxy("codex", {
      appPort: "20127",
      state: "codex-state",
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
        disableEnvProxy: true,
      },
    );
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        providerSpecificData: { authMethod: "oauth", proxyPoolId: "pool-1" },
      }),
      expect.objectContaining({ beforePersist: expect.any(Function) }),
    );
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

    const response = await POST(new Request("http://localhost/api/oauth/codex/poll-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "poll-state" }),
    }), {
      params: Promise.resolve({ provider: "codex", action: "poll-status" }),
    });

    expect(await response.json()).toEqual({
      status: "done",
      connectionId: "connection-1",
      email: "user@example.com",
    });
  });

  it.each([
    ["codex", "/auth/callback"],
    ["xai", "/callback"],
  ])("retains terminal %s status until idempotent acknowledgement", async (provider, callbackPath) => {
    const state = `retained-${provider}`;
    await startProxy(provider, {
      appPort: 20127,
      state,
      codeVerifier: "secret-verifier",
      redirectUri: provider === "codex"
        ? "http://localhost:1455/auth/callback"
        : "http://127.0.0.1:56121/callback",
    });
    await httpMocks.servers.at(-1).request(`${callbackPath}?code=auth-code&state=${state}`);

    const postAction = (action) => POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }), {
      params: Promise.resolve({ provider, action }),
    });
    const first = await (await postAction("poll-status")).json();
    const second = await (await postAction("poll-status")).json();
    const acknowledged = await postAction("ack-status");
    const afterAck = await (await postAction("poll-status")).json();
    const repeatedAck = await postAction("ack-status");

    expect(first.status).toBe("done");
    expect(second).toEqual(first);
    expect(acknowledged.status).toBe(200);
    expect(afterAck).toEqual({ status: "unknown" });
    expect(repeatedAck.status).toBe(200);
  });

  it("refuses to acknowledge a pending fixed callback", async () => {
    registerCodexSession({
      state: "pending-ack",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });

    const response = await POST(new Request("http://localhost/api/oauth/codex/ack-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "pending-ack" }),
    }), {
      params: Promise.resolve({ provider: "codex", action: "ack-status" }),
    });

    expect(response.status).toBe(409);
    expect(getCodexSessionStatus("pending-ack")).toEqual({ status: "pending" });
  });

  it("rejects state in GET status query strings", async () => {
    registerCodexSession({
      state: "poll-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });

    const response = await GET(new Request(
      "http://localhost/api/oauth/codex/poll-status?state=poll-state",
    ), {
      params: Promise.resolve({ provider: "codex", action: "poll-status" }),
    });

    expect(response.status).toBe(400);
  });

  it("reads status state only from a POST JSON body", async () => {
    registerCodexSession({
      state: "poll-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });

    const response = await POST(new Request("http://localhost/api/oauth/codex/poll-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "poll-state" }),
    }), {
      params: Promise.resolve({ provider: "codex", action: "poll-status" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
  });

  it("refuses missing or mismatched stop state while a fixed flow is active", async () => {
    await startCodexProxy(20127);
    registerCodexSession({
      state: "codex-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });

    for (const body of [{}, { state: "wrong-state" }]) {
      const response = await POST(new Request("http://localhost/api/oauth/codex/stop-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), {
        params: Promise.resolve({ provider: "codex", action: "stop-proxy" }),
      });
      expect(response.status).toBe(409);
    }

    expect(getCodexSessionStatus("codex-state")).toEqual({ status: "pending" });
    expect(httpMocks.servers.at(-1).close).not.toHaveBeenCalled();
  });

  it("clears the pending session named by stop-proxy", async () => {
    await startProxy("codex", {
      appPort: 20127,
      state: "codex-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    expect(getCodexSessionStatus("codex-state")).not.toBeNull();

    await POST(new Request("http://localhost/api/oauth/codex/stop-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "codex-state" }),
    }), {
      params: Promise.resolve({ provider: "codex", action: "stop-proxy" }),
    });

    expect(getCodexSessionStatus("codex-state")).toBeNull();
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession, getCodexSessionStatus],
    ["xai", startXaiProxy, registerXaiSession, getXaiSessionStatus],
  ])("preserves active %s session when stop-proxy omits state", async (provider, start, register, getStatus) => {
    await start(20127);
    register({ state: "orphan", codeVerifier: "secret", redirectUri: "http://callback" });
    const server = httpMocks.servers.at(-1);

    const response = await POST(new Request(`http://localhost/api/oauth/${provider}/stop-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), {
      params: Promise.resolve({ provider, action: "stop-proxy" }),
    });

    expect(response.status).toBe(409);
    expect(getStatus("orphan")).toEqual({ status: "pending" });
    expect(server.close).not.toHaveBeenCalled();
  });

  it.each([
    ["codex", registerCodexSession, getCodexSessionStatus, clearCodexSessions],
    ["xai", registerXaiSession, getXaiSessionStatus, clearXaiSessions],
  ])("refuses new %s sessions at capacity without evicting active state", (_provider, register, getStatus, clearSessions) => {
    try {
      for (let index = 0; index < 128; index += 1) {
        expect(register({
          state: `bounded-session-${index}`,
          codeVerifier: `verifier-${index}`,
          redirectUri: "http://callback",
        })).toBe(true);
      }
      expect(register({
        state: "bounded-session-128",
        codeVerifier: "verifier-128",
        redirectUri: "http://callback",
      })).toBe(false);

      expect(getStatus("bounded-session-0")).toEqual({ status: "pending" });
      expect(getStatus("bounded-session-127")).toEqual({ status: "pending" });
      expect(getStatus("bounded-session-128")).toBeNull();
    } finally {
      clearSessions();
    }
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
    ["codex", startCodexProxy, registerCodexSession],
    ["xai", startXaiProxy, registerXaiSession],
  ])("extends reused %s callback server lifetime for a later session", async (_provider, start, register) => {
    vi.useFakeTimers();
    await start(20127);
    register({ state: "first", codeVerifier: "first-secret", redirectUri: "http://callback" });
    const server = httpMocks.servers.at(-1);

    await vi.advanceTimersByTimeAsync(299_000);
    register({ state: "second", codeVerifier: "second-secret", redirectUri: "http://callback" });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(server.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(298_001);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession],
    ["xai", startXaiProxy, registerXaiSession],
  ])("claims %s callback state before token exchange", async (_provider, start, register) => {
    const releaseExchanges = [];
    mocks.exchangeTokens.mockImplementation(() => new Promise((resolve) => {
      releaseExchanges.push(() => resolve({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        email: "user@example.com",
        providerSpecificData: { authMethod: "oauth" },
      }));
    }));
    await start(20127);
    register({ state: "first", codeVerifier: "secret", redirectUri: "http://callback" });
    const server = httpMocks.servers.at(-1);

    const first = server.request("/callback?code=first-code&state=first");
    await vi.waitFor(() => expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1));
    const duplicate = server.request("/callback?code=second-code&state=first");
    await new Promise((resolve) => setImmediate(resolve));
    const exchangeCountBeforeRelease = mocks.exchangeTokens.mock.calls.length;
    releaseExchanges.forEach((release) => release());
    await Promise.all([first, duplicate]);

    expect(exchangeCountBeforeRelease).toBe(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession, clearCodexSession],
    ["xai", startXaiProxy, registerXaiSession, clearXaiSession],
  ])("does not persist a cancelled %s callback after exchange completes", async (_provider, start, register, clear) => {
    let releaseExchange;
    mocks.exchangeTokens.mockImplementation(() => new Promise((resolve) => {
      releaseExchange = resolve;
    }));
    await start(20127);
    register({ state: "late-cancel", codeVerifier: "secret", redirectUri: "http://callback" });

    const callback = httpMocks.servers.at(-1).request("/callback?code=late-code&state=late-cancel");
    await vi.waitFor(() => expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1));
    clear("late-cancel");
    releaseExchange({ accessToken: "late-token", refreshToken: "late-refresh" });
    await callback;

    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession, clearCodexSession, "/auth/callback"],
    ["xai", startXaiProxy, registerXaiSession, clearXaiSession, "/callback"],
  ])("rechecks %s identity during delayed DB admission", async (_provider, start, register, clear, callbackPath) => {
    let releaseAdmission;
    let persisted = false;
    mocks.createProviderConnection.mockImplementation(async (_data, options) => {
      await new Promise((resolve) => { releaseAdmission = resolve; });
      if (options?.beforePersist?.() === false) throw new Error("OAuth flow was cancelled");
      persisted = true;
      return { id: "late-connection", provider: _provider };
    });
    await start(20127);
    register({ state: "delayed-db", codeVerifier: "secret", redirectUri: "http://callback" });

    const callback = httpMocks.servers.at(-1).request(`${callbackPath}?code=late-code&state=delayed-db`);
    await vi.waitFor(() => expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1));
    clear("delayed-db");
    releaseAdmission();
    await callback;

    expect(persisted).toBe(false);
  });

  it("rechecks xAI manual flow identity during delayed DB admission", async () => {
    await startProxy("xai", {
      appPort: 20127,
      state: "manual-delayed-db",
      codeVerifier: "secret-verifier",
      redirectUri: "http://127.0.0.1:56121/callback",
    });
    let releaseAdmission;
    let persisted = false;
    mocks.createProviderConnection.mockImplementation(async (_data, options) => {
      await new Promise((resolve) => { releaseAdmission = resolve; });
      if (options?.beforePersist?.() === false) throw new Error("OAuth flow was cancelled");
      persisted = true;
      return { id: "late-connection", provider: "xai" };
    });

    const request = POST(new Request("http://localhost/api/oauth/xai/manual-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "manual-code", state: "manual-delayed-db" }),
    }), {
      params: Promise.resolve({ provider: "xai", action: "manual-code" }),
    });
    await vi.waitFor(() => expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1));
    clearXaiSession("manual-delayed-db");
    releaseAdmission();
    const response = await request;

    expect(response.status).toBe(409);
    expect(persisted).toBe(false);
  });

  it.each([
    ["codex", startCodexProxy, registerCodexSession],
    ["xai", startXaiProxy, registerXaiSession],
  ])("rejects unknown %s callback state while server-side session exists", async (_provider, start, register) => {
    await start(20127);
    register({ state: "first", codeVerifier: "secret", redirectUri: "http://callback" });

    const response = await httpMocks.servers.at(-1).request("/callback?code=code&state=unknown");

    expect(response.status).toBe(400);
    expect(response.headers.Location).toBeUndefined();
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("does not persist a device result after its flow is cancelled", async () => {
    let releasePoll;
    mocks.pollForToken.mockImplementation(() => new Promise((resolve) => {
      releasePoll = resolve;
    }));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("cancelled-flow");
    const started = await GET(new Request("http://localhost/api/oauth/qwen/device-code"), {
      params: Promise.resolve({ provider: "qwen", action: "device-code" }),
    });
    const { flowId } = await started.json();
    const pollResponse = POST(new Request("http://localhost/api/oauth/qwen/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId }),
    }), {
      params: Promise.resolve({ provider: "qwen", action: "poll" }),
    });
    await vi.waitFor(() => expect(mocks.pollForToken).toHaveBeenCalledTimes(1));

    const cancelResponse = await POST(new Request("http://localhost/api/oauth/qwen/cancel-poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId }),
    }), {
      params: Promise.resolve({ provider: "qwen", action: "cancel-poll" }),
    });
    releasePoll({
      success: true,
      tokens: { accessToken: "stale-token", expiresIn: 3600 },
    });
    const result = await pollResponse;

    expect(cancelResponse.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: false, cancelled: true });
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it("refuses device admission at capacity without evicting active flows", async () => {
    const provider = "capacity-device";
    let sequence = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `bounded-flow-${sequence++}`);
    mocks.pollForToken.mockResolvedValue({
      success: false,
      error: "authorization_pending",
      pending: true,
    });
    for (let index = 0; index < 128; index += 1) {
      const response = await GET(new Request(`http://localhost/api/oauth/${provider}/device-code`), {
        params: Promise.resolve({ provider, action: "device-code" }),
      });
      expect(response.status).toBe(200);
    }
    const rejected = await GET(new Request(`http://localhost/api/oauth/${provider}/device-code`), {
      params: Promise.resolve({ provider, action: "device-code" }),
    });

    const poll = (flowId) => POST(new Request(`http://localhost/api/oauth/${provider}/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId }),
    }), {
      params: Promise.resolve({ provider, action: "poll" }),
    });
    const oldest = await poll("bounded-flow-0");
    const newest = await poll("bounded-flow-127");
    const refused = await poll("bounded-flow-128");

    expect(rejected.status).toBe(503);
    expect(oldest.status).toBe(200);
    expect(newest.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(mocks.requestDeviceCode).toHaveBeenCalledTimes(128);
    expect(mocks.pollForToken).toHaveBeenCalledTimes(2);
  });

  it("expires unconsumed device flows after their TTL", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("expired-device-flow");
    const started = await GET(new Request("http://localhost/api/oauth/qwen/device-code"), {
      params: Promise.resolve({ provider: "qwen", action: "device-code" }),
    });
    const { flowId } = await started.json();
    vi.mocked(Date.now).mockReturnValue(now + 15 * 60 * 1000 + 1);

    const response = await POST(new Request("http://localhost/api/oauth/qwen/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId }),
    }), {
      params: Promise.resolve({ provider: "qwen", action: "poll" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.pollForToken).not.toHaveBeenCalled();
  });

  it.each([
    ["codex", "/auth/callback"],
    ["xai", "/callback"],
  ])("sanitizes public %s callback errors", async (provider, callbackPath) => {
    const state = `public-error-${provider}`;
    const secrets = [
      "relay-user",
      "relay-password",
      "SECRET-AUTH-CODE",
      "SECRET-ACCESS-TOKEN",
      "SECRET-REFRESH-TOKEN",
      "SECRET-PKCE-VERIFIER",
      "SECRET-OAUTH-STATE",
      "provider-body-secret",
    ];
    mocks.exchangeTokens.mockRejectedValue(new Error(
      "exchange failed at https://relay-user:relay-password@relay.test/callback" +
      "?code=SECRET-AUTH-CODE&access_token=SECRET-ACCESS-TOKEN" +
      "&refresh_token=SECRET-REFRESH-TOKEN#SECRET-OAUTH-STATE " +
      "code_verifier=SECRET-PKCE-VERIFIER body=provider-body-secret",
    ));
    await startProxy(provider, {
      appPort: 20127,
      state,
      codeVerifier: "server-verifier",
      redirectUri: provider === "codex"
        ? "http://localhost:1455/auth/callback"
        : "http://127.0.0.1:56121/callback",
    });

    const callback = await httpMocks.servers.at(-1).request(
      `${callbackPath}?code=callback-code&state=${state}`,
    );
    const statusResponse = await POST(new Request(
      `http://localhost/api/oauth/${provider}/poll-status`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) },
    ), {
      params: Promise.resolve({ provider, action: "poll-status" }),
    });
    const status = await statusResponse.json();

    expect(status.status).toBe("error");
    expect(status.error).toMatch(/restart sign-in/i);
    expect(status.error.length).toBeLessThanOrEqual(240);
    for (const secret of secrets) {
      expect(callback.body).not.toContain(secret);
      expect(status.error).not.toContain(secret);
    }
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
      disableEnvProxy: true,
    });
  });

  it("claims xAI manual-code state before token exchange", async () => {
    await startProxy("xai", {
      appPort: 20127,
      state: "xai-state",
      codeVerifier: "secret-verifier",
      redirectUri: "http://127.0.0.1:56121/callback",
      proxyPoolId: "pool-1",
    });
    const releaseExchanges = [];
    mocks.exchangeTokens.mockImplementation(() => new Promise((resolve) => {
      releaseExchanges.push(() => resolve({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        email: "user@example.com",
        providerSpecificData: { authMethod: "oauth" },
      }));
    }));
    const manualRequest = (code) => POST(new Request("http://localhost/api/oauth/xai/manual-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: "xai-state", proxyPoolId: "pool-1" }),
    }), {
      params: Promise.resolve({ provider: "xai", action: "manual-code" }),
    });

    const first = manualRequest("first-code");
    await vi.waitFor(() => expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1));
    const duplicate = manualRequest("second-code");
    await new Promise((resolve) => setImmediate(resolve));
    const exchangeCountBeforeRelease = mocks.exchangeTokens.mock.calls.length;
    releaseExchanges.forEach((release) => release());
    await Promise.all([first, duplicate]);

    expect(exchangeCountBeforeRelease).toBe(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
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

    const responsePromise = POST(new Request("http://localhost/api/oauth/codex/stop-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), {
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
