import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let connection;
const snapshot = (observedAtMs = Date.now() - 1000, remaining = 10) => ({
  version: 1, provider: "codex", observedAtMs,
  quotas: { session: { resetMs: Date.now() + 3600000, remaining, unlimited: false } },
});

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-quota-persistence-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/localDb.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.updateSettings({ providerStrategies: { codex: { quotaResetFirst: true } } });
  connection = await db.createProviderConnection({
    provider: "codex", authType: "oauth", name: "original",
    providerSpecificData: { workspace: "original", quotaRouting: { legacy: true } },
  });
});

describe("atomic quota routing persistence", () => {
  it.each([false, true])("keeps the newest sample with reversed order=%s", async (reverse) => {
    const older = snapshot(Date.now() - 3000, 20);
    const newer = snapshot(Date.now() - 2000, 5);
    const samples = reverse ? [newer, older] : [older, newer];
    await Promise.all(samples.map((sample) => db.updateProviderQuotaRoutingSnapshot(connection.id, sample)));
    expect((await db.getProviderConnectionById(connection.id)).quotaRoutingSnapshot).toEqual(newer);
    const equal = await db.updateProviderQuotaRoutingSnapshot(connection.id, { ...older, observedAtMs: newer.observedAtMs });
    expect(equal.quotaRoutingSnapshot).toEqual(newer);
  });

  it("ignores an older request that completes after a newer request", async () => {
    const older = snapshot(Date.now() - 3000);
    const newer = snapshot(Date.now() - 2000, 2);
    let complete;
    const pending = new Promise((resolve) => { complete = resolve; })
      .then(() => db.updateProviderQuotaRoutingSnapshot(connection.id, older));
    await db.updateProviderQuotaRoutingSnapshot(connection.id, newer);
    complete();
    expect((await pending).quotaRoutingSnapshot).toEqual(newer);
  });

  it("merges only the top-level snapshot, preserving concurrent user and PSD updates", async () => {
    const sample = snapshot();
    const patch = {
      name: "edited", accessToken: "test-token", refreshToken: "test-refresh",
      globalPriority: 17, providerSpecificData: { workspace: "edited", quotaRouting: { legacy: "edited" } },
    };
    await Promise.all([
      db.updateProviderConnection(connection.id, patch),
      db.updateProviderQuotaRoutingSnapshot(connection.id, sample),
    ]);
    const current = await db.getProviderConnectionById(connection.id);
    expect(current).toMatchObject(patch);
    expect(current.quotaRoutingSnapshot).toEqual(sample);
    const before = await db.getProviderConnections();
    const newer = snapshot(Date.now() - 500);
    const updated = await db.updateProviderQuotaRoutingSnapshot(connection.id, newer);
    expect(updated).toEqual({ ...current, quotaRoutingSnapshot: newer });
    expect(await db.getProviderConnections()).toEqual(before.map((c) => c.id === connection.id ? updated : c));
    await db.updateProviderConnection(connection.id, { providerSpecificData: { workspace: "later" } });
    expect((await db.getProviderConnectionById(connection.id)).quotaRoutingSnapshot).toEqual(newer);
  });

  it.each([false, "true", undefined])("requires current strict opt-in: %s", async (quotaResetFirst) => {
    await Promise.all([
      db.updateSettings({ providerStrategies: { codex: { quotaResetFirst } } }),
      db.updateProviderQuotaRoutingSnapshot(connection.id, snapshot()),
    ]);
    expect((await db.getProviderConnectionById(connection.id)).quotaRoutingSnapshot).toBeUndefined();
  });

  it.each([{ isActive: false }, { authType: "apikey" }, { provider: "claude" }])("rechecks current connection eligibility %j", async (patch) => {
    await db.updateProviderConnection(connection.id, patch);
    const before = await db.getProviderConnectionById(connection.id);
    expect(await db.updateProviderQuotaRoutingSnapshot(connection.id, snapshot())).toEqual(before);
  });

  it("does not recreate deleted or missing rows", async () => {
    await db.deleteProviderConnection(connection.id);
    expect(await db.updateProviderQuotaRoutingSnapshot(connection.id, snapshot())).toBeNull();
    expect(await db.updateProviderQuotaRoutingSnapshot("missing", snapshot())).toBeNull();
  });

  it.each([
    null, {}, { version: 2 }, { observedAtMs: undefined }, { observedAtMs: NaN },
    { observedAtMs: Infinity }, { observedAtMs: "123" }, { observedAtMs: 0 },
    { observedAtMs: Date.now() + 3600000 }, { observedAtMs: Date.now() - 700000 },
    { quotas: null }, { quotas: [] }, { provider: "unknown" },
  ])("ignores invalid snapshots %j", async (invalid) => {
    const before = await db.getProviderConnectionById(connection.id);
    const input = invalid === null ? null : Object.keys(invalid).length ? { ...snapshot(), ...invalid } : {};
    expect(await db.updateProviderQuotaRoutingSnapshot(connection.id, input)).toEqual(before);
    expect(await db.getProviderConnectionById(connection.id)).toEqual(before);
  });

  it("normalizes quotas and strips malformed rows and unrelated input fields", async () => {
    const sample = snapshot();
    const updated = await db.updateProviderQuotaRoutingSnapshot(connection.id, {
      ...sample, accessToken: "ignored", providerSpecificData: { workspace: "ignored" },
      quotas: { ...sample.quotas, bad: { remaining: -1, resetMs: 123 }, invalid: null },
    });
    expect(updated.quotaRoutingSnapshot).toEqual(sample);
    expect(updated.providerSpecificData).toEqual(connection.providerSpecificData);
    expect(updated.accessToken).toBeUndefined();
  });
});
