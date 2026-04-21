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
});
