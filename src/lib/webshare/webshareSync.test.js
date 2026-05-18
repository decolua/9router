import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettings = vi.fn();
const updateSettings = vi.fn();
const getProxyPoolsBySource = vi.fn();
const upsertProxyPoolBySource = vi.fn();
const updateProxyPool = vi.fn();
const listProxiesAll = vi.fn();

vi.mock("@/lib/localDb.js", () => ({
  getSettings,
  updateSettings,
}));

vi.mock("@/lib/db/repos/proxyPoolsRepo.js", () => ({
  getProxyPoolsBySource,
  upsertProxyPoolBySource,
  updateProxyPool,
}));

vi.mock("./webshareClient.js", async () => {
  const actual = await vi.importActual("./webshareClient.js");
  return {
    ...actual,
    listProxiesAll,
  };
});

describe("runWebshareSync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.__webshareSync = { inFlight: null };

    getSettings.mockResolvedValue({
      webshareApiKey: "test-key",
      webshareSyncIntervalMinutes: 30,
      webshareDeletedProxyIds: [],
    });
    updateSettings.mockResolvedValue(undefined);
    getProxyPoolsBySource.mockResolvedValue([]);
    upsertProxyPoolBySource.mockResolvedValue(undefined);
    updateProxyPool.mockResolvedValue(undefined);
    listProxiesAll.mockResolvedValue([]);
  });

  it("uses stable webshareId upsert path so existing row id stays bound", async () => {
    const localPools = [
      {
        id: "uuid-1",
        source: "webshare",
        sourceId: "A",
        webshareId: "A",
        createdAt: "2026-01-01T00:00:00.000Z",
        webshareUsername: "old-user",
      },
    ];
    const upsertResults = [];

    getProxyPoolsBySource.mockResolvedValue(localPools);
    listProxiesAll.mockResolvedValue([
      {
        webshareId: "A",
        username: "new-user",
        proxyAddress: "1.2.3.4",
        countryCode: "US",
        cityName: "NYC",
        valid: true,
        proxyUrl: "http://new-user:new-pass@1.2.3.4:80",
      },
    ]);
    upsertProxyPoolBySource.mockImplementation(async ({ source, sourceId, fields }) => {
      const existing = localPools.find(
        (pool) => pool.source === source && String(pool.webshareId) === String(sourceId)
      );
      const result = existing
        ? { ...existing, ...fields, source, sourceId, webshareId: sourceId, id: existing.id }
        : { source, sourceId, webshareId: sourceId, ...fields };
      upsertResults.push(result);
      return result;
    });

    const { runWebshareSync } = await import("./webshareSync.js");

    const stats = await runWebshareSync({ trigger: "manual" });

    expect(upsertProxyPoolBySource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "webshare",
        sourceId: "A",
      })
    );
    expect(upsertResults).toEqual([
      expect.objectContaining({
        id: "uuid-1",
        webshareId: "A",
        webshareUsername: "new-user",
      }),
    ]);
    expect(updateProxyPool).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ created: 0, updated: 1, deactivated: 0, skipped: 0, total: 1 });
  });

  it("aborts on empty remote list before deactivating existing rows", async () => {
    getProxyPoolsBySource.mockResolvedValue([
      { id: "uuid-1", webshareId: "A", isActive: true },
    ]);
    listProxiesAll.mockResolvedValue([]);

    const { runWebshareSync } = await import("./webshareSync.js");

    await expect(runWebshareSync({ trigger: "manual" })).rejects.toThrow(
      "Refusing to deactivate all"
    );
    expect(updateProxyPool).not.toHaveBeenCalled();
  });

  it("marks missing remote rows inactive without touching surviving rows", async () => {
    getProxyPoolsBySource.mockResolvedValue([
      { id: "uuid-1", webshareId: "A", isActive: true },
      { id: "uuid-2", webshareId: "B", isActive: true },
    ]);
    listProxiesAll.mockResolvedValue([
      {
        webshareId: "B",
        username: "user-b",
        proxyAddress: "5.6.7.8",
        countryCode: "SG",
        cityName: "Singapore",
        valid: true,
        proxyUrl: "http://user-b:pass@5.6.7.8:80",
      },
    ]);

    const { runWebshareSync } = await import("./webshareSync.js");

    const stats = await runWebshareSync({ trigger: "manual" });

    expect(upsertProxyPoolBySource).toHaveBeenCalledTimes(1);
    expect(upsertProxyPoolBySource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "B" })
    );
    expect(updateProxyPool).toHaveBeenCalledTimes(1);
    expect(updateProxyPool).toHaveBeenCalledWith(
      "uuid-1",
      expect.objectContaining({
        isActive: false,
        webshareValid: false,
        webshareOrphanedAt: expect.any(String),
      })
    );
    expect(updateProxyPool).not.toHaveBeenCalledWith(
      "uuid-2",
      expect.anything()
    );
    expect(stats).toMatchObject({ created: 0, updated: 1, deactivated: 1, skipped: 0, total: 1 });
  });

  it("does not recreate Webshare proxies deleted by the user", async () => {
    getSettings.mockResolvedValue({
      webshareApiKey: "test-key",
      webshareSyncIntervalMinutes: 30,
      webshareDeletedProxyIds: ["A"],
    });
    getProxyPoolsBySource.mockResolvedValue([]);
    listProxiesAll.mockResolvedValue([
      {
        webshareId: "A",
        username: "user-a",
        proxyAddress: "1.2.3.4",
        countryCode: "US",
        cityName: "NYC",
        valid: true,
        proxyUrl: "http://user-a:pass@1.2.3.4:80",
      },
    ]);

    const { runWebshareSync } = await import("./webshareSync.js");

    const stats = await runWebshareSync({ trigger: "manual" });

    expect(upsertProxyPoolBySource).not.toHaveBeenCalled();
    expect(updateProxyPool).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ created: 0, updated: 0, deactivated: 0, skipped: 1, total: 1 });
  });
});
