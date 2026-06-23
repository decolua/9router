import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = [];
let forceRenewConflictOnce = false;

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

vi.mock("uuid", () => ({
  v4: () => "mocked-uuid",
}));

function matchesWhere(row, whereSql, params) {
  if (whereSql.includes("id = ?")) return row.id === params[0];
  if (whereSql.includes("key = ?")) return row.key === params[0];
  return false;
}

function makeDb() {
  return {
    all(sql) {
      if (sql.includes("SELECT * FROM apiKeys ORDER BY")) {
        return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }
      return [];
    },
    get(sql, params = []) {
      if (sql.includes("SELECT * FROM apiKeys WHERE")) {
        return rows.find((row) => matchesWhere(row, sql, params)) || null;
      }
      return null;
    },
    run(sql, params = []) {
      if (sql.includes("SET isActive = 0") && sql.includes("expiresAt <= ?")) {
        const [updatedAt, now] = params;
        let changes = 0;
        for (const row of rows) {
          if (row.expiresAt && row.expiresAt <= now && row.isActive !== 0 && row.isActive !== false) {
            row.isActive = 0;
            row.deactivatedReason = "expired";
            row.updatedAt = updatedAt;
            changes += 1;
          }
        }
        return { changes };
      }

      if (sql.startsWith("INSERT INTO apiKeys")) {
        rows.push({
          id: params[0],
          key: params[1],
          name: params[2],
          machineId: params[3],
          isActive: params[4],
          planMonths: params[5],
          expiresAt: params[6],
          deactivatedReason: params[7],
          createdAt: params[8],
          updatedAt: params[9],
        });
        return { changes: 1 };
      }

      if (sql.startsWith("UPDATE apiKeys")) {
        const expectedVersion = params[9];
        const row = rows.find((item) => item.id === params[8]);
        if (!row) return { changes: 0 };
        if ((row.updatedAt || row.createdAt) !== expectedVersion) return { changes: 0 };
        if (forceRenewConflictOnce && row.id === "active") {
          forceRenewConflictOnce = false;
          row.updatedAt = "2026-06-19T00:00:00.000Z";
          row.expiresAt = "2026-08-18T14:52:33.301Z";
          return { changes: 0 };
        }
        row.key = params[0];
        row.name = params[1];
        row.machineId = params[2];
        row.isActive = params[3];
        row.planMonths = params[4];
        row.expiresAt = params[5];
        row.deactivatedReason = params[6];
        row.updatedAt = params[7];
        return { changes: 1 };
      }

      return { changes: 0 };
    },
    transaction(fn) {
      return fn();
    },
  };
}

const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");

describe("apiKeysRepo expiration", () => {
  beforeEach(() => {
    rows.length = 0;
    forceRenewConflictOnce = false;
    mocks.getAdapter.mockResolvedValue(makeDb());
  });

  it("lazy expires overdue keys when listing", async () => {
    rows.push({
      id: "expired",
      key: "sk-expired",
      name: "Expired User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const keys = await repo.getApiKeys({ now: new Date("2026-06-23T00:00:00.000Z") });

    expect(keys[0]).toMatchObject({
      isActive: false,
      deactivatedReason: "expired",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("renewal extends from future expiration", async () => {
    rows.push({
      id: "active",
      key: "sk-active",
      name: "Active User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-07-18T14:52:33.301Z",
      deactivatedReason: null,
      createdAt: "2026-06-18T14:52:33.301Z",
      updatedAt: "2026-06-18T14:52:33.301Z",
    });

    const renewed = await repo.renewApiKey("active", 1, new Date("2026-06-23T00:00:00.000Z"));

    expect(renewed).toMatchObject({
      expiresAt: "2026-08-18T14:52:33.301Z",
      isActive: true,
      deactivatedReason: null,
      planMonths: 1,
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("validateApiKey rejects expired keys after lazy expiry", async () => {
    rows.push({
      id: "expired",
      key: "sk-expired",
      name: "Expired User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    await expect(
      repo.validateApiKey("sk-expired", { now: new Date("2026-06-23T00:00:00.000Z") })
    ).resolves.toBe(false);

    expect(rows[0]).toMatchObject({
      isActive: 0,
      deactivatedReason: "expired",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("validateApiKey only expires the requested key on the hot path", async () => {
    rows.push({
      id: "expired-one",
      key: "sk-expired-one",
      name: "Expired One",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    rows.push({
      id: "expired-two",
      key: "sk-expired-two",
      name: "Expired Two",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-02T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    await expect(
      repo.validateApiKey("sk-expired-one", { now: new Date("2026-06-23T00:00:00.000Z") })
    ).resolves.toBe(false);

    expect(rows[0]).toMatchObject({
      isActive: 0,
      deactivatedReason: "expired",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    expect(rows[1]).toMatchObject({
      isActive: 1,
      deactivatedReason: null,
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("does not let expired keys be reactivated through update", async () => {
    rows.push({
      id: "expired",
      key: "sk-expired",
      name: "Expired User",
      machineId: "machine",
      isActive: 0,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: "expired",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    });

    const updated = await repo.updateApiKey(
      "expired",
      { isActive: true, deactivatedReason: null },
      { now: new Date("2026-06-23T00:00:00.000Z") }
    );

    expect(updated).toMatchObject({
      isActive: false,
      deactivatedReason: "expired",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("accepts boolean-like isActive values from existing callers", async () => {
    rows.push({
      id: "active",
      key: "sk-active",
      name: "Active User",
      machineId: "machine",
      isActive: 0,
      planMonths: 1,
      expiresAt: "2026-07-18T14:52:33.301Z",
      deactivatedReason: "manual",
      createdAt: "2026-06-18T14:52:33.301Z",
      updatedAt: "2026-06-18T14:52:33.301Z",
    });

    const updated = await repo.updateApiKey(
      "active",
      { isActive: "1" },
      { now: new Date("2026-06-23T00:00:00.000Z") }
    );

    expect(updated).toMatchObject({
      isActive: true,
      deactivatedReason: null,
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });

  it("retries renewal when a concurrent update wins the first write", async () => {
    rows.push({
      id: "active",
      key: "sk-active",
      name: "Active User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-07-18T14:52:33.301Z",
      deactivatedReason: null,
      createdAt: "2026-06-18T14:52:33.301Z",
      updatedAt: "2026-06-18T14:52:33.301Z",
    });
    forceRenewConflictOnce = true;

    const renewed = await repo.renewApiKey("active", 1, new Date("2026-06-23T00:00:00.000Z"));

    expect(renewed).toMatchObject({
      expiresAt: "2026-09-18T14:52:33.301Z",
      isActive: true,
      deactivatedReason: null,
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
  });
});
