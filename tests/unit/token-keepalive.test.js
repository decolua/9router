import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("@/shared/constants/config", () => ({
  TOKEN_KEEPALIVE_CONFIG: {
    tickIntervalMs: 300000,
    failureCooldownMs: 1800000,
  },
}));

function oauthConn(overrides = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    provider: "grok-cli",
    email: "user@example.com",
    authType: "oauth",
    refreshToken: "rt",
    accessToken: "at",
    expiresAt: "2020-01-01T00:00:00.000Z",
    providerSpecificData: {},
    ...overrides,
  };
}

describe("token keep-alive", () => {
  let runTokenKeepAliveTick;
  let keepConnectionAlive;
  let deps;
  let state;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete global.__tokenKeepAlive;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    ({ runTokenKeepAliveTick, keepConnectionAlive } = await import("../../src/shared/services/tokenKeepAlive.js"));

    deps = {
      getProviderConnections: vi.fn().mockResolvedValue([]),
      updateProviderConnection: vi.fn(),
      resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
      refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection, refreshed: false })),
    };
    state = { interval: null, running: false, failureCache: {} };
  });

  it("only walks active connections", async () => {
    await runTokenKeepAliveTick(deps, state);
    expect(deps.getProviderConnections).toHaveBeenCalledWith({ isActive: true });
  });

  it("skips connections that cannot refresh", async () => {
    deps.getProviderConnections.mockResolvedValue([
      oauthConn({ id: "a", authType: "apikey" }),
      oauthConn({ id: "b", refreshToken: null }),
    ]);
    await runTokenKeepAliveTick(deps, state);
    expect(deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
  });

  it("delegates the due check to refreshAndUpdateCredentials (force=false)", async () => {
    const conn = oauthConn();
    deps.getProviderConnections.mockResolvedValue([conn]);
    await runTokenKeepAliveTick(deps, state);
    expect(deps.refreshAndUpdateCredentials).toHaveBeenCalledWith(conn, false, expect.objectContaining({ strictProxy: false }));
  });

  it("allows the background scheduler to force a due connection refresh", async () => {
    const conn = oauthConn();
    await keepConnectionAlive(conn, deps, state, true);
    expect(deps.refreshAndUpdateCredentials).toHaveBeenCalledWith(
      conn,
      true,
      expect.objectContaining({ strictProxy: false }),
    );
  });

  it("reports a refresh and clears any previous failure", async () => {
    const conn = oauthConn();
    state.failureCache[conn.id] = Date.now() - 3600000; // old enough to retry
    deps.refreshAndUpdateCredentials.mockResolvedValue({
      connection: { ...conn, expiresAt: "2030-01-01T00:00:00.000Z" },
      refreshed: true,
    });
    const result = await keepConnectionAlive(conn, deps, state);
    expect(result).toEqual({ refreshed: true });
    expect(state.failureCache[conn.id]).toBeUndefined();
  });

  it("persists a rejected refresh token as lastError", async () => {
    const conn = oauthConn();
    deps.refreshAndUpdateCredentials.mockResolvedValue({ connection: conn, refreshed: false, refreshFailed: true });
    const result = await keepConnectionAlive(conn, deps, state);
    expect(result).toEqual({ failed: true });
    expect(deps.updateProviderConnection).toHaveBeenCalledWith(conn.id, expect.objectContaining({
      lastError: expect.stringContaining("Token refresh failed"),
    }));
    expect(state.failureCache[conn.id]).toBeGreaterThan(0);
  });

  it("persists a thrown refresh error too", async () => {
    const conn = oauthConn();
    deps.refreshAndUpdateCredentials.mockRejectedValue(new Error("re-authorize the connection"));
    const result = await keepConnectionAlive(conn, deps, state);
    expect(result).toEqual({ failed: true });
    expect(deps.updateProviderConnection).toHaveBeenCalledWith(conn.id, expect.objectContaining({
      lastError: expect.stringContaining("re-authorize the connection"),
    }));
  });

  it("backs off a failing connection instead of retrying every tick", async () => {
    const conn = oauthConn();
    state.failureCache[conn.id] = Date.now();
    const result = await keepConnectionAlive(conn, deps, state);
    expect(result).toEqual({ skipped: "failure-cooldown" });
    expect(deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
  });

  it("never writes model locks — cooldowns stay owned by the request path", async () => {
    const conn = oauthConn();
    deps.refreshAndUpdateCredentials.mockResolvedValue({ connection: conn, refreshed: false, refreshFailed: true });
    await keepConnectionAlive(conn, deps, state);
    const written = deps.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(written).some((k) => k.startsWith("modelLock_"))).toBe(false);
    expect(written).not.toHaveProperty("isActive");
  });

  it("one failing connection does not stop the rest of the tick", async () => {
    const bad = oauthConn({ id: "bad" });
    const good = oauthConn({ id: "good" });
    deps.getProviderConnections.mockResolvedValue([bad, good]);
    deps.refreshAndUpdateCredentials.mockImplementation(async (c) => {
      if (c.id === "bad") throw new Error("boom");
      return { connection: c, refreshed: true };
    });
    await runTokenKeepAliveTick(deps, state);
    expect(deps.refreshAndUpdateCredentials).toHaveBeenCalledTimes(2);
  });

  it("does not run two ticks concurrently", async () => {
    state.running = true;
    await runTokenKeepAliveTick(deps, state);
    expect(deps.getProviderConnections).not.toHaveBeenCalled();
  });
});
