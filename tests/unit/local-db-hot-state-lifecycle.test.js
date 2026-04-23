import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs = [];

async function createTempDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "9router-hot-state-"));
  tempDirs.push(dir);
  return dir;
}

async function loadModulesWithTempDataDir() {
  const dataDir = await createTempDataDir();
  process.env.DATA_DIR = dataDir;
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  vi.resetModules();

  const providerHotState = await import("../../src/lib/providerHotState.js");
  const localDb = await import("../../src/lib/localDb.js");

  providerHotState.__resetProviderHotStateForTests();

  return { dataDir, localDb, providerHotState };
}

async function readDbJson(dataDir) {
  const raw = await fs.readFile(path.join(dataDir, "db.json"), "utf8");
  return JSON.parse(raw);
}

function createFakeRedisClient() {
  const hashes = new Map();

  return {
    isReady: true,
    async hGetAll(key) {
      return { ...(hashes.get(key) || {}) };
    },
    async hSet(key, payload) {
      hashes.set(key, {
        ...(hashes.get(key) || {}),
        ...(payload || {}),
      });
    },
    async hDel(key, field) {
      const current = { ...(hashes.get(key) || {}) };
      delete current[field];
      if (Object.keys(current).length === 0) hashes.delete(key);
      else hashes.set(key, current);
    },
    async expire() {
      return true;
    },
    async del(key) {
      hashes.delete(key);
    },
  };
}

afterEach(async () => {
  delete process.env.DATA_DIR;
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  vi.resetModules();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("localDb hot-state lifecycle", () => {
  it("clears stale provider hot state during database import", async () => {
    const { localDb, providerHotState } = await loadModulesWithTempDataDir();

    await localDb.createProviderConnection({
      id: "conn-import",
      provider: "provider-import",
      name: "Before import",
      apiKey: "secret",
      isActive: true,
      priority: 1,
      testStatus: "active",
    });

    await providerHotState.setConnectionHotState("conn-import", "provider-import", {
      routingStatus: "blocked_auth",
      authState: "expired",
      quotaState: "exhausted",
      testStatus: "unavailable",
      lastError: "stale overlay",
    });

    await localDb.importDb({
      providerConnections: [
        {
          id: "conn-import",
          provider: "provider-import",
          name: "Imported",
          apiKey: "imported-secret",
          isActive: true,
          priority: 1,
          testStatus: "active",
        },
      ],
    });

    expect(providerHotState.__getProviderHotStateSnapshotForTests("provider-import")).toBeNull();

    const importedConnection = await localDb.getProviderConnectionById("conn-import");

    expect(importedConnection).toMatchObject({
      id: "conn-import",
      provider: "provider-import",
      name: "Imported",
      testStatus: "active",
    });
    expect(importedConnection).not.toHaveProperty("lastError");
    expect(importedConnection).not.toHaveProperty("authState");
    expect(importedConnection).not.toHaveProperty("quotaState");
    expect(importedConnection).not.toHaveProperty("routingStatus");
  });

  it("clears provider hot state when deleting provider connections in bulk", async () => {
    const { localDb, providerHotState } = await loadModulesWithTempDataDir();

    await localDb.createProviderConnection({
      id: "conn-delete-1",
      provider: "provider-delete",
      name: "Delete one",
      apiKey: "key-1",
      isActive: true,
      priority: 1,
      testStatus: "active",
    });
    await localDb.createProviderConnection({
      id: "conn-delete-2",
      provider: "provider-delete",
      name: "Delete two",
      apiKey: "key-2",
      isActive: true,
      priority: 2,
      testStatus: "active",
    });

    await providerHotState.setConnectionHotState("conn-delete-1", "provider-delete", {
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      testStatus: "unavailable",
    });
    await providerHotState.setConnectionHotState("conn-delete-2", "provider-delete", {
      routingStatus: "blocked_health",
      reasonDetail: "stale health",
      testStatus: "error",
    });

    await expect(localDb.deleteProviderConnectionsByProvider("provider-delete")).resolves.toBe(2);
    expect(providerHotState.__getProviderHotStateSnapshotForTests("provider-delete")).toBeNull();
    await expect(localDb.getProviderConnections({ provider: "provider-delete" })).resolves.toEqual([]);
  });

  it("durably persists projected legacy fallback fields for redis-backed hot-only updates", async () => {
    const { dataDir, localDb, providerHotState } = await loadModulesWithTempDataDir();

    process.env.REDIS_URL = "redis://example.test:6379";
    providerHotState.__setRedisClientForTests(createFakeRedisClient());

    const created = await localDb.createProviderConnection({
      provider: "provider-redis-fallback",
      name: "Redis fallback",
      apiKey: "secret",
      isActive: true,
      priority: 1,
      testStatus: "active",
    });

    await localDb.updateProviderConnection(created.id, {
      routingStatus: "blocked_auth",
      authState: "expired",
      reasonDetail: "Authentication expired",
    });

    const persistedDb = await readDbJson(dataDir);
    expect(
      persistedDb.providerConnections.find((connection) => connection.id === created.id)
    ).toMatchObject({
      id: created.id,
      authState: "expired",
      reasonDetail: "Authentication expired",
    });

    providerHotState.__resetProviderHotStateForTests();
    delete process.env.REDIS_URL;

    const recovered = await localDb.getProviderConnectionById(created.id);
    expect(recovered).toMatchObject({
      id: created.id,
      provider: "provider-redis-fallback",
      authState: "expired",
      reasonDetail: "Authentication expired",
    });
  });

  it("writes mixed updates to both centralized hot state and persisted db fields", async () => {
    const { dataDir, localDb, providerHotState } = await loadModulesWithTempDataDir();

    process.env.REDIS_URL = "redis://example.test:6379";
    providerHotState.__setRedisClientForTests(createFakeRedisClient());

    const created = await localDb.createProviderConnection({
      provider: "provider-mixed-update",
      name: "Before mixed update",
      apiKey: "old-secret",
      isActive: true,
      priority: 1,
      testStatus: "active",
    });

    await localDb.updateProviderConnection(created.id, {
      apiKey: "new-secret",
      name: "After mixed update",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: "2026-04-22T12:00:00.000Z",
    });

    expect(providerHotState.__getProviderHotStateSnapshotForTests("provider-mixed-update")).toMatchObject({
      connections: {
        [created.id]: expect.objectContaining({
          routingStatus: "exhausted",
          quotaState: "exhausted",
          nextRetryAt: "2026-04-22T12:00:00.000Z",
        }),
      },
    });

    const persistedDb = await readDbJson(dataDir);
    expect(
      persistedDb.providerConnections.find((connection) => connection.id === created.id)
    ).toMatchObject({
      id: created.id,
      name: "After mixed update",
      apiKey: "new-secret",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: "2026-04-22T12:00:00.000Z",
    });
  });
});
