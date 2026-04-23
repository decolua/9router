import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs = [];

vi.mock("@/lib/dataDir.js", () => ({
  getDataDir: () => process.env.DATA_DIR,
  DATA_DIR: process.env.DATA_DIR,
}));

const mockGetConnectionEffectiveStatus = vi.fn((connection) => connection?.__status || "unknown");
const mockGetConnectionStatusDetails = vi.fn((connection) => ({
  status: connection?.__status || "unknown",
}));

vi.mock("@/lib/connectionStatus.js", () => ({
  getConnectionEffectiveStatus: mockGetConnectionEffectiveStatus,
  getConnectionStatusDetails: mockGetConnectionStatusDetails,
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

vi.mock("@/lib/opencodeSync/schema.js", () => ({
  createDefaultOpenCodePreferences: vi.fn(() => ({})),
  normalizeOpenCodePreferences: vi.fn((value) => (value && typeof value === "object" ? value : {})),
  validateOpenCodePreferences: vi.fn((value) => (value && typeof value === "object" ? value : {})),
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

beforeEach(() => {
  mockGetConnectionEffectiveStatus.mockReset();
  mockGetConnectionEffectiveStatus.mockImplementation((connection) => connection?.__status || "unknown");
  mockGetConnectionStatusDetails.mockReset();
  mockGetConnectionStatusDetails.mockImplementation((connection) => ({
    status: connection?.__status || "unknown",
  }));
});

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
      quotaExhaustedThresholdPercent: 10,
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

  it("summarizes canonical statuses as connected/error/unknown buckets", async () => {
    const localDb = await loadLocalDb();

    mockGetConnectionStatusDetails
      .mockReturnValueOnce({ status: "eligible" })
      .mockReturnValueOnce({ status: "exhausted" })
      .mockReturnValueOnce({ status: "blocked" })
      .mockReturnValueOnce({ status: "disabled" })
      .mockReturnValueOnce({ status: "unknown" });

    const summary = localDb.getConnectionStatusSummary([
      { id: "conn-eligible" },
      { id: "conn-exhausted" },
      { id: "conn-blocked" },
      { id: "conn-disabled", isActive: false },
      { id: "conn-unknown" },
    ]);

    expect(summary).toEqual({
      connected: 1,
      error: 2,
      unknown: 2,
      total: 5,
      allDisabled: false,
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

  it("persists explicit quota exhausted threshold updates", async () => {
    const localDb = await loadLocalDb();

    const updated = await localDb.updateSettings({
      quotaExhaustedThresholdPercent: 15,
    });

    expect(updated).toMatchObject({
      quotaExhaustedThresholdPercent: 15,
    });

    await expect(localDb.getSettings()).resolves.toMatchObject({
      quotaExhaustedThresholdPercent: 15,
    });
  });

  it("clamps quota exhausted threshold updates to valid percentage range", async () => {
    const localDb = await loadLocalDb();

    const high = await localDb.updateSettings({
      quotaExhaustedThresholdPercent: 150,
    });
    expect(high).toMatchObject({
      quotaExhaustedThresholdPercent: 100,
    });

    const low = await localDb.updateSettings({
      quotaExhaustedThresholdPercent: -5,
    });
    expect(low).toMatchObject({
      quotaExhaustedThresholdPercent: 0,
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

  it("isolates quota scheduler defaults from caller-side nested mutations", async () => {
    const localDb = await loadLocalDb({ settings: {} });

    const baseline = await localDb.getSettings();
    const firstRead = await localDb.getSettings();
    firstRead.quotaScheduler.enabled = false;
    firstRead.quotaScheduler.batchSize = 999;
    firstRead.quotaScheduler.successTtlMs = 123;

    const secondRead = await localDb.getSettings();
    expect(secondRead.quotaScheduler).toEqual(baseline.quotaScheduler);
  });
});
