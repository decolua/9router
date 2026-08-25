import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs = [];
const adapters = [
  ["better-sqlite3", async (file) => (await import("@/lib/db/adapters/betterSqliteAdapter.js")).createBetterSqliteAdapter(file)],
  ["sql.js", async (file) => (await import("@/lib/db/adapters/sqljsAdapter.js")).createSqlJsAdapter(file)],
];

function seed(adapter) {
  adapter.exec("CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, authType TEXT, name TEXT, email TEXT, priority INTEGER, isActive INTEGER, data TEXT, createdAt TEXT, updatedAt TEXT)");
  adapter.run("INSERT INTO providerConnections VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["c1", "test", "apikey", "name", null, 1, 1, JSON.stringify({ apiKey: "preserved", unrelated: "field" }), "created", "created"]);
}

async function repo(adapter) {
  vi.resetModules();
  vi.doMock("@/lib/db/driver.js", () => ({ getAdapter: vi.fn(async () => adapter) }));
  return import("@/lib/db/repos/connectionsRepo.js");
}

afterEach(() => {
  vi.doUnmock("@/lib/db/driver.js");
  vi.resetModules();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("adaptive quota locks", () => {
  for (const [name, create] of adapters) {
    it(`keeps longer metadata and exact stale clear behavior in ${name}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quota-${name}-`)); dirs.push(dir);
      const adapter = await create(path.join(dir, "data.sqlite"));
      seed(adapter);
      const locks = await repo(adapter);
      const long = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "long", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
      const short = { expiresAt: "2026-08-02T00:00:00.000Z", reason: "short", source: "relay_internal", classifiedAt: "2026-08-01T00:00:02.000Z" };
      await locks.extendConnectionModelLock("c1", "model-a", long);
      await locks.extendConnectionModelLock("c1", "model-a", short);
      await locks.extendConnectionModelLock("c1", "model-b", short);
      await locks.extendConnectionModelLock("c1", null, long);
      expect(await locks.clearConnectionModelLockIfObserved("c1", "model-a", short)).toBe(false);
      expect(await locks.clearConnectionModelLockIfObserved("c1", "model-a", long)).toBe(true);
      expect(await locks.getProviderConnectionById("c1")).toMatchObject({ apiKey: "preserved", unrelated: "field", "modelLock___all": long.expiresAt, "modelLock_model-b": short.expiresAt });
      adapter.close();
    });
  }

  it("keeps equal-expiry newer metadata distinct", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-equal-")); dirs.push(dir);
    const adapter = await adapters[1][1](path.join(dir, "data.sqlite")); seed(adapter);
    const locks = await repo(adapter);
    const first = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "first", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    const second = { ...first, reason: "second", classifiedAt: "2026-08-01T00:00:02.000Z" };
    await locks.extendConnectionModelLock("c1", "model-a", first);
    await locks.extendConnectionModelLock("c1", "model-a", second);
    expect((await locks.getProviderConnectionById("c1"))["modelLock_model-aReason"]).toBe("second");
    adapter.close();
  });

  it("does not clear the global lock when clearing an exact model", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-global-")); dirs.push(dir);
    const adapter = await adapters[1][1](path.join(dir, "data.sqlite")); seed(adapter);
    const locks = await repo(adapter);
    const lock = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "quota", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    await locks.extendConnectionModelLock("c1", null, lock);
    await locks.extendConnectionModelLock("c1", "model-a", lock);
    await locks.clearConnectionModelLockIfObserved("c1", "model-a", lock);
    expect(await locks.getProviderConnectionById("c1")).toMatchObject({ "modelLock___all": lock.expiresAt });
    adapter.close();
  });

  it("returns immutable observed exact-model tokens", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-observed-")); dirs.push(dir);
    const adapter = await adapters[1][1](path.join(dir, "data.sqlite")); seed(adapter);
    const locks = await repo(adapter);
    const lock = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "quota", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    await locks.extendConnectionModelLock("c1", "model-a", lock);
    expect(locks.getObservedConnectionModelLock(await locks.getProviderConnectionById("c1"), "model-a")).toEqual({ expiresAt: lock.expiresAt, classifiedAt: lock.classifiedAt });
    adapter.close();
  });

  it("does not clear a lock when only the observed ClassifiedAt is stale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-classified-")); dirs.push(dir);
    const adapter = await adapters[1][1](path.join(dir, "data.sqlite")); seed(adapter);
    const locks = await repo(adapter);
    const lock = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "quota", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    await locks.extendConnectionModelLock("c1", "model-a", lock);
    expect(await locks.clearConnectionModelLockIfObserved("c1", "model-a", { ...lock, classifiedAt: "stale" })).toBe(false);
    expect((await locks.getProviderConnectionById("c1"))["modelLock_model-a"]).toBe(lock.expiresAt);
    adapter.close();
  });

  it("keeps unrelated connection data through a transactional lock update", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-fields-")); dirs.push(dir);
    const adapter = await adapters[1][1](path.join(dir, "data.sqlite")); seed(adapter);
    const locks = await repo(adapter);
    const lock = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "quota", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    await locks.extendConnectionModelLock("c1", "model-a", lock);
    expect(await locks.getProviderConnectionById("c1")).toMatchObject({ apiKey: "preserved", unrelated: "field" });
    adapter.close();
  });

  it("shares independently created sql.js writers and persists longer state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-independent-")); dirs.push(dir);
    const file = path.join(dir, "data.sqlite");
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const first = await createSqlJsAdapter(file); const second = await createSqlJsAdapter(file);
    seed(first);
    const firstRepo = await repo(first); const secondRepo = await repo(second);
    const long = { expiresAt: "2026-09-01T00:00:00.000Z", reason: "long", source: "target_response", classifiedAt: "2026-08-01T00:00:01.000Z" };
    const short = { expiresAt: "2026-08-02T00:00:00.000Z", reason: "short", source: "relay_internal", classifiedAt: "2026-08-01T00:00:02.000Z" };
    await firstRepo.extendConnectionModelLock("c1", "model-a", long);
    await secondRepo.extendConnectionModelLock("c1", "model-a", short);
    expect(await secondRepo.clearConnectionModelLockIfObserved("c1", "model-a", short)).toBe(false);
    first.close(); second.close();
    const reopened = await createSqlJsAdapter(file);
    expect((await (await repo(reopened)).getProviderConnectionById("c1"))["modelLock_model-a"]).toBe(long.expiresAt);
    reopened.close();
  });
});
