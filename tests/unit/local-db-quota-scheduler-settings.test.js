import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs = [];

vi.mock("@/lib/dataDir.js", () => ({
  getDataDir: () => process.env.DATA_DIR,
  DATA_DIR: process.env.DATA_DIR,
}));

vi.mock("@/lib/connectionStatus.js", () => ({
  getConnectionEffectiveStatus: () => "unknown",
}));

vi.mock("@/lib/quotaStateStore.js", () => ({
  clearAllHotState: vi.fn(async () => {}),
  clearProviderHotState: vi.fn(async () => {}),
  deleteConnectionHotState: vi.fn(async () => {}),
  mergeConnectionsWithHotState: vi.fn(async (connections) => connections),
  setConnectionHotState: vi.fn(async () => null),
  isHotOnlyUpdate: vi.fn(() => false),
  isRedisHotStateReady: vi.fn(() => false),
  projectLegacyConnectionState: vi.fn((value) => value || {}),
}));

async function createTempDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "9router-quota-settings-"));
  tempDirs.push(dir);
  return dir;
}

async function loadLocalDb(initialData) {
  const dataDir = await createTempDataDir();
  process.env.DATA_DIR = dataDir;
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;

  if (initialData) {
    await fs.writeFile(path.join(dataDir, "db.json"), JSON.stringify(initialData, null, 2));
  }

  vi.resetModules();
  return import("../../src/lib/localDb.js");
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

describe("localDb quota scheduler settings", () => {
  it("returns quota scheduler defaults for a fresh database", async () => {
    const localDb = await loadLocalDb();

    await expect(localDb.getSettings()).resolves.toMatchObject({
      quotaScheduler: {
        enabled: true,
        cadenceMs: 900000,
        successTtlMs: 900000,
        errorTtlMs: 300000,
        exhaustedTtlMs: 60000,
        batchSize: 25,
      },
    });
  });

  it("preserves an explicit disabled scheduler choice after updates", async () => {
    const localDb = await loadLocalDb();

    const updated = await localDb.updateSettings({
      quotaScheduler: {
        enabled: false,
      },
    });

    expect(updated.quotaScheduler).toMatchObject({
      enabled: false,
      cadenceMs: 900000,
      successTtlMs: 900000,
      errorTtlMs: 300000,
      exhaustedTtlMs: 60000,
      batchSize: 25,
    });

    await expect(localDb.getSettings()).resolves.toMatchObject({
      quotaScheduler: {
        enabled: false,
      },
    });
  });

  it("merges partial quota scheduler updates with nested defaults", async () => {
    const localDb = await loadLocalDb();

    const updated = await localDb.updateSettings({
      quotaScheduler: {
        enabled: true,
        batchSize: 10,
      },
    });

    expect(updated.quotaScheduler).toMatchObject({
      enabled: true,
      cadenceMs: 900000,
      successTtlMs: 900000,
      errorTtlMs: 300000,
      exhaustedTtlMs: 60000,
      batchSize: 10,
    });
  });

  it("clamps quota scheduler cadence to a minimum of 15 minutes", async () => {
    const localDb = await loadLocalDb();

    const updated = await localDb.updateSettings({
      quotaScheduler: {
        cadenceMs: 300000,
      },
    });

    expect(updated.quotaScheduler).toMatchObject({
      cadenceMs: 900000,
    });
  });
});
