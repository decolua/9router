import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs = [];

async function createTempDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "9router-localdb-status-write-"));
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

describe("localDb provider connection status writes", () => {
  it("summarizes canonical statuses without legacy-source fallback", async () => {
    const { localDb } = await loadModulesWithTempDataDir();

    expect(localDb.getConnectionStatusSummary([
      { routingStatus: "eligible", quotaState: "ok", authState: "ok", healthStatus: "healthy" },
      { authState: "invalid", routingStatus: "eligible" },
      { testStatus: "active" },
    ])).toEqual({
      connected: 1,
      error: 1,
      unknown: 1,
      total: 3,
      allDisabled: false,
    });
  });

  it("does not persist legacy status fields during create upsert normalization", async () => {
    const { dataDir, localDb } = await loadModulesWithTempDataDir();

    const created = await localDb.createProviderConnection({
      provider: "provider-upsert",
      authType: "apikey",
      name: "Same Name",
      apiKey: "secret",
      isActive: true,
      priority: 1,
    });

    const upserted = await localDb.createProviderConnection({
      provider: "provider-upsert",
      authType: "apikey",
      name: "Same Name",
      routingStatus: "blocked",
      authState: "expired",
      reasonCode: "auth_invalid",
      lastCheckedAt: "2026-04-22T12:00:00.000Z",
      testStatus: "expired",
      lastError: "Authentication expired",
      lastErrorType: "auth_invalid",
      lastErrorAt: "2026-04-22T12:00:00.000Z",
      rateLimitedUntil: "2026-04-22T12:00:00.000Z",
      lastTested: "2026-04-22T12:00:00.000Z",
      errorCode: "auth_invalid",
    });

    expect(upserted.id).toBe(created.id);
    expect(upserted).toMatchObject({
      id: created.id,
      routingStatus: "blocked",
      authState: "expired",
      reasonCode: "auth_invalid",
      lastCheckedAt: "2026-04-22T12:00:00.000Z",
    });
    expect(upserted).not.toHaveProperty("testStatus", "expired");
    expect(upserted).not.toHaveProperty("lastError", "Authentication expired");
    expect(upserted).not.toHaveProperty("lastErrorType", "auth_invalid");
    expect(upserted).not.toHaveProperty("lastErrorAt", "2026-04-22T12:00:00.000Z");
    expect(upserted).not.toHaveProperty("rateLimitedUntil", "2026-04-22T12:00:00.000Z");
    expect(upserted).not.toHaveProperty("lastTested", "2026-04-22T12:00:00.000Z");
    expect(upserted).not.toHaveProperty("errorCode", "auth_invalid");

    const persisted = (await readDbJson(dataDir)).providerConnections.find((c) => c.id === created.id);
    expect(persisted).toMatchObject({
      id: created.id,
      routingStatus: "blocked",
      authState: "expired",
      reasonCode: "auth_invalid",
      lastCheckedAt: "2026-04-22T12:00:00.000Z",
    });
    expect(persisted).not.toHaveProperty("testStatus", "expired");
    expect(persisted).not.toHaveProperty("lastError", "Authentication expired");
    expect(persisted).not.toHaveProperty("lastErrorType", "auth_invalid");
    expect(persisted).not.toHaveProperty("lastErrorAt", "2026-04-22T12:00:00.000Z");
    expect(persisted).not.toHaveProperty("rateLimitedUntil", "2026-04-22T12:00:00.000Z");
    expect(persisted).not.toHaveProperty("lastTested", "2026-04-22T12:00:00.000Z");
    expect(persisted).not.toHaveProperty("errorCode", "auth_invalid");
  });

  it("does not persist synthesized legacy mirror fields for redis-backed hot-only updates", async () => {
    const { dataDir, localDb, providerHotState } = await loadModulesWithTempDataDir();

    process.env.REDIS_URL = "redis://example.test:6379";
    providerHotState.__setRedisClientForTests(createFakeRedisClient());

    const created = await localDb.createProviderConnection({
      provider: "provider-hot-only",
      name: "Hot only",
      apiKey: "secret",
      isActive: true,
      priority: 1,
      testStatus: "active",
    });

    await localDb.updateProviderConnection(created.id, {
      routingStatus: "blocked",
      authState: "expired",
      reasonCode: "auth_invalid",
      lastCheckedAt: "2026-04-22T12:00:00.000Z",
      testStatus: "expired",
      lastError: "Authentication expired",
      rateLimitedUntil: "2026-04-22T12:00:00.000Z",
      lastTested: "2026-04-22T12:00:00.000Z",
      errorCode: "auth_invalid",
    });

    const persisted = (await readDbJson(dataDir)).providerConnections.find((c) => c.id === created.id);
    expect(persisted).toMatchObject({
      id: created.id,
      routingStatus: "blocked",
      authState: "expired",
      reasonCode: "auth_invalid",
      lastCheckedAt: "2026-04-22T12:00:00.000Z",
    });
    expect(persisted).not.toHaveProperty("testStatus", "expired");
    expect(persisted).not.toHaveProperty("lastError", "Authentication expired");
    expect(persisted).not.toHaveProperty("rateLimitedUntil", "2026-04-22T12:00:00.000Z");
    expect(persisted).not.toHaveProperty("lastTested", "2026-04-22T12:00:00.000Z");
    expect(persisted).not.toHaveProperty("errorCode", "auth_invalid");
  });

  it("keeps canonical fields and avoids persisting legacy mirrors for mixed updates", async () => {
    const { dataDir, localDb, providerHotState } = await loadModulesWithTempDataDir();

    process.env.REDIS_URL = "redis://example.test:6379";
    providerHotState.__setRedisClientForTests(createFakeRedisClient());

    const created = await localDb.createProviderConnection({
      provider: "provider-mixed",
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
      testStatus: "unavailable",
    });

    const persisted = (await readDbJson(dataDir)).providerConnections.find((c) => c.id === created.id);
    expect(persisted).toMatchObject({
      id: created.id,
      name: "After mixed update",
      apiKey: "new-secret",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: "2026-04-22T12:00:00.000Z",
    });
    expect(persisted).not.toHaveProperty("testStatus", "unavailable");
    expect(persisted).not.toHaveProperty("rateLimitedUntil", "2026-04-22T12:00:00.000Z");
  });

  it("drops legacy top-level routing statuses during localDb writes while keeping canonical details", async () => {
    const { dataDir, localDb } = await loadModulesWithTempDataDir();

    const created = await localDb.createProviderConnection({
      provider: "provider-canonicalize-routing",
      authType: "apikey",
      name: "Canonicalize Routing",
      apiKey: "secret",
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      nextRetryAt: "2026-04-22T12:00:00.000Z",
    });

    expect(created).toMatchObject({
      quotaState: "exhausted",
      nextRetryAt: "2026-04-22T12:00:00.000Z",
    });
    expect(created).not.toHaveProperty("routingStatus");

    await localDb.updateProviderConnection(created.id, {
      routingStatus: "blocked_health",
      healthStatus: "unhealthy",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });

    const persisted = (await readDbJson(dataDir)).providerConnections.find((c) => c.id === created.id);
    expect(persisted).toMatchObject({
      id: created.id,
      healthStatus: "unhealthy",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });
    expect(persisted).not.toHaveProperty("routingStatus");
  });
});
