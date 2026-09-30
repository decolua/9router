/**
 * Background OAuth token-refresh scheduler.
 *
 * Covers pure selection (selectConnectionsNeedingRefresh) and a fake tick that
 * exercises checkAndRefreshToken dispatch + fail-open per connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function conn(overrides = {}) {
  return {
    id: "c1",
    provider: "grok-cli",
    authType: "oauth",
    refreshToken: "rt-1",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
    ...overrides,
  };
}

describe("selectConnectionsNeedingRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("selects oauth grok-cli connection expiring in 10 minutes", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("c1");
  });

  it("skips connection expiring in 2 hours", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("never selects apikey connections", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [
        conn({ authType: "apikey", refreshToken: "rt" }),
        conn({ id: "c2", authType: "api_key", refreshToken: "rt" }),
      ],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("skips oauth connection without refreshToken", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ refreshToken: null }), conn({ id: "c2", refreshToken: undefined })],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("selects already-expired oauth connection", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW - 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(1);
  });
});

describe("runBackgroundTokenRefreshTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls refresh only for due connections and swallows per-connection errors", async () => {
    const due = conn({
      id: "due",
      expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    });
    const notDue = conn({
      id: "not-due",
      expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    });
    const apikey = conn({
      id: "key",
      authType: "apikey",
      expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    });

    const refreshConnection = vi.fn(async (c) => {
      if (c.id === "due") throw new Error("boom");
      return c;
    });
    const loadConnections = vi.fn(async () => [due, notDue, apikey]);

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await expect(
      runBackgroundTokenRefreshTick({ loadConnections, refreshConnection })
    ).resolves.toBeUndefined();

    expect(loadConnections).toHaveBeenCalledTimes(1);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(refreshConnection.mock.calls[0][0].id).toBe("due");
  });

  it("does not call refresh when nothing is due", async () => {
    const refreshConnection = vi.fn();
    const loadConnections = vi.fn(async () => [
      conn({
        expiresAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it("swallows top-level load errors", async () => {
    const refreshConnection = vi.fn();
    const loadConnections = vi.fn(async () => {
      throw new Error("db down");
    });

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await expect(
      runBackgroundTokenRefreshTick({ loadConnections, refreshConnection })
    ).resolves.toBeUndefined();
    expect(refreshConnection).not.toHaveBeenCalled();
  });
});

describe("start/stop guards", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    const mod = await import("../../src/sse/services/backgroundTokenRefresh.js");
    mod.stopBackgroundTokenRefresh();
    vi.resetModules();
  });

  it("honors DISABLE_BACKGROUND_TOKEN_REFRESH kill-switch", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_TOKEN_REFRESH", "1");
    const { startBackgroundTokenRefresh, stopBackgroundTokenRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    expect(startBackgroundTokenRefresh()).toBe(false);
    stopBackgroundTokenRefresh();
  });

  it("is idempotent: second start is no-op", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_TOKEN_REFRESH", "");
    const { startBackgroundTokenRefresh, stopBackgroundTokenRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const first = startBackgroundTokenRefresh({ intervalMs: 60_000 });
    const second = startBackgroundTokenRefresh({ intervalMs: 60_000 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    stopBackgroundTokenRefresh();
  });
});
