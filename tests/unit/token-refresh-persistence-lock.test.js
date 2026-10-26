import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
const upstream = vi.hoisted(() => ({ refreshTokenByProvider: vi.fn() }));

vi.mock("../../src/lib/localDb.js", () => db);
vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...await importOriginal(),
  refreshTokenByProvider: upstream.refreshTokenByProvider,
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));

import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function expiredCredentials(id = "connection-one") {
  return {
    connectionId: id,
    accessToken: "fixture-access-old",
    refreshToken: "fixture-refresh-old",
    expiresAt: "2020-01-01T00:00:00.000Z",
    lastRefreshAt: "2020-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("proactive refresh persistence boundary", () => {
  it("does not reuse a rotated token while its replacement is being persisted", async () => {
    const credentials = expiredCredentials();
    let stored = { ...credentials };
    const persistStarted = deferred();
    const finishPersist = deferred();
    db.getProviderConnectionById.mockImplementation(async () => ({ ...stored }));
    db.updateProviderConnection.mockImplementation(async (_id, updates) => {
      persistStarted.resolve();
      await finishPersist.promise;
      stored = { ...stored, ...updates };
      return stored;
    });
    upstream.refreshTokenByProvider.mockImplementation(async (_provider, snapshot) => {
      if (snapshot.refreshToken !== "fixture-refresh-old" ||
          upstream.refreshTokenByProvider.mock.calls.length > 1) {
        throw new Error("rotated refresh token was reused");
      }
      return {
        accessToken: "fixture-access-new",
        refreshToken: "fixture-refresh-new",
        expiresIn: 7200,
      };
    });

    const first = checkAndRefreshToken("codex", credentials);
    await persistStarted.promise;
    // The provider has rotated the token, but the database still holds the old one.
    const second = checkAndRefreshToken("codex", credentials);
    const outcomes = Promise.allSettled([first, second]);
    try {
      // Drain promise continuations without depending on wall-clock timing.
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(upstream.refreshTokenByProvider).toHaveBeenCalledTimes(1);
    } finally {
      finishPersist.resolve();
      await outcomes;
    }
    const settled = await outcomes;
    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(settled.map((result) => result.value.refreshToken)).toEqual([
      "fixture-refresh-new", "fixture-refresh-new",
    ]);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("adopts a persisted refresh even when the provider keeps the refresh token", async () => {
    const credentials = expiredCredentials();
    let stored = { ...credentials };
    db.getProviderConnectionById.mockImplementation(async () => ({ ...stored }));
    db.updateProviderConnection.mockImplementation(async (_id, updates) => {
      stored = { ...stored, ...updates };
      return stored;
    });
    upstream.refreshTokenByProvider.mockResolvedValue({
      accessToken: "fixture-access-renewed", expiresIn: 7200,
    });
    const results = await Promise.all([
      checkAndRefreshToken("codex", credentials),
      checkAndRefreshToken("codex", credentials),
    ]);
    expect(results.map((result) => result.accessToken)).toEqual([
      "fixture-access-renewed", "fixture-access-renewed",
    ]);
    expect(upstream.refreshTokenByProvider).toHaveBeenCalledTimes(1);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("allows unrelated connections to refresh without waiting for a blocked write", async () => {
    const blocked = expiredCredentials("blocked-connection");
    const independent = expiredCredentials("independent-connection");
    const persistStarted = deferred();
    const finishPersist = deferred();
    db.getProviderConnectionById.mockImplementation(async (id) => ({
      ...(id === blocked.connectionId ? blocked : independent),
    }));
    upstream.refreshTokenByProvider.mockImplementation(async (_provider, snapshot) => ({
      accessToken: `fixture-access-${snapshot.connectionId}`,
      refreshToken: `fixture-refresh-${snapshot.connectionId}`,
      expiresIn: 7200,
    }));
    db.updateProviderConnection.mockImplementation(async (id, updates) => {
      if (id === blocked.connectionId) {
        persistStarted.resolve();
        await finishPersist.promise;
      }
      return { id, ...updates };
    });
    const first = checkAndRefreshToken("codex", blocked);
    await persistStarted.promise;
    try {
      const other = await checkAndRefreshToken("codex", independent);
      expect(other.refreshToken).toBe("fixture-refresh-independent-connection");
      expect(upstream.refreshTokenByProvider).toHaveBeenCalledTimes(2);
    } finally {
      finishPersist.resolve();
      await first;
    }
  });

  it("releases a failed check and lets the next caller retry", async () => {
    const credentials = expiredCredentials();
    db.getProviderConnectionById.mockResolvedValue(credentials);
    db.updateProviderConnection.mockImplementation(async (_id, updates) => updates);
    upstream.refreshTokenByProvider
      .mockRejectedValueOnce(new Error("fixture provider unavailable"))
      .mockResolvedValueOnce({ accessToken: "fixture-access-retry", expiresIn: 7200 });

    const results = await Promise.allSettled([
      checkAndRefreshToken("codex", credentials),
      checkAndRefreshToken("codex", credentials),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[0].reason.message).toBe("fixture provider unavailable");
    expect(results[1].status).toBe("fulfilled");
    expect(results[1].value.accessToken).toBe("fixture-access-retry");
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("preserves each caller's snapshot and explicit force option", async () => {
    const credentials = {
      ...expiredCredentials(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      lastRefreshAt: new Date().toISOString(),
    };
    db.getProviderConnectionById.mockResolvedValue(credentials);
    db.updateProviderConnection.mockImplementation(async (_id, updates) => updates);
    upstream.refreshTokenByProvider.mockResolvedValue({
      accessToken: "fixture-access-forced", refreshToken: "fixture-refresh-forced", expiresIn: 7200,
    });

    const [normal, forced] = await Promise.all([
      checkAndRefreshToken("codex", { ...credentials, marker: "normal" }),
      checkAndRefreshToken("codex", { ...credentials, marker: "forced" }, { force: true }),
    ]);
    expect(normal.accessToken).toBe(credentials.accessToken);
    expect(normal.marker).toBe("normal");
    expect(forced.accessToken).toBe("fixture-access-forced");
    expect(forced.marker).toBe("forced");
    expect(upstream.refreshTokenByProvider).toHaveBeenCalledTimes(1);
  });

  it("treats id and connectionId as the same connection when guarding persistence", async () => {
    const credentials = expiredCredentials();
    let stored = { ...credentials };
    const persistStarted = deferred();
    const finishPersist = deferred();
    db.getProviderConnectionById.mockImplementation(async () => ({ ...stored }));
    db.updateProviderConnection.mockImplementation(async (_id, updates) => {
      persistStarted.resolve();
      await finishPersist.promise;
      stored = { ...stored, ...updates };
      return stored;
    });
    upstream.refreshTokenByProvider.mockResolvedValue({
      accessToken: "fixture-access-new", refreshToken: "fixture-refresh-new", expiresIn: 7200,
    });
    const first = checkAndRefreshToken("codex", credentials);
    await persistStarted.promise;
    const { connectionId, ...snapshot } = credentials;
    const second = checkAndRefreshToken("codex", { ...snapshot, id: connectionId });
    const outcomes = Promise.allSettled([first, second]);
    try {
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(upstream.refreshTokenByProvider).toHaveBeenCalledTimes(1);
    } finally {
      finishPersist.resolve();
      await outcomes;
    }
    expect((await outcomes).every((result) => result.status === "fulfilled")).toBe(true);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });
});
