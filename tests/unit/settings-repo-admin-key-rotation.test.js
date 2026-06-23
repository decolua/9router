import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseJson } from "../../src/lib/db/helpers/jsonCol.js";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
}));

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

const { rotateAdminApiKeySettings } = await import("../../src/lib/db/repos/settingsRepo.js");

function createDb(initial = {}) {
  let data = initial;
  let inTransaction = false;
  return {
    events: [],
    get(sql) {
      expect(sql).toContain("SELECT data FROM settings");
      return { data: JSON.stringify(data) };
    },
    run(sql, params) {
      expect(inTransaction).toBe(true);
      expect(sql).toContain("INSERT INTO settings");
      data = parseJson(params[0], {});
    },
    transaction(fn) {
      inTransaction = true;
      this.events.push("begin");
      try {
        const result = fn();
        this.events.push("commit");
        return result;
      } finally {
        inTransaction = false;
      }
    },
    isInTransaction() {
      return inTransaction;
    },
    readData() {
      return data;
    },
  };
}

describe("settings repo admin api key rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates and persists admin key hash inside the adapter transaction", async () => {
    const db = createDb({ adminApiKeyCreatedAt: "2026-06-22T00:00:00.000Z" });
    mocks.getAdapter.mockResolvedValue(db);

    const result = await rotateAdminApiKeySettings({
      now: new Date("2026-06-23T00:00:00.000Z"),
      generateKey: () => {
        expect(db.isInTransaction()).toBe(true);
        return "9r-admin-plaintext";
      },
      hashKey: (key) => {
        expect(db.isInTransaction()).toBe(true);
        expect(key).toBe("9r-admin-plaintext");
        return "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      },
    });

    expect(result).toEqual({
      key: "9r-admin-plaintext",
      status: {
        configured: true,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    });
    expect(db.readData()).toMatchObject({
      adminApiKeyHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      adminApiKeyCreatedAt: "2026-06-22T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-23T00:00:00.000Z",
    });
    expect(JSON.stringify(db.readData())).not.toContain("9r-admin-plaintext");
    expect(db.events).toEqual(["begin", "commit"]);
  });

  it("processes concurrent rotations through the transaction helper", async () => {
    const db = createDb({});
    mocks.getAdapter.mockResolvedValue(db);
    const keys = ["9r-admin-first", "9r-admin-second"];

    const [first, second] = await Promise.all([
      rotateAdminApiKeySettings({
        now: new Date("2026-06-23T00:00:00.000Z"),
        generateKey: () => keys.shift(),
        hashKey: (key) => `sha256:${key === "9r-admin-first" ? "1".repeat(64) : "2".repeat(64)}`,
      }),
      rotateAdminApiKeySettings({
        now: new Date("2026-06-24T00:00:00.000Z"),
        generateKey: () => keys.shift(),
        hashKey: (key) => `sha256:${key === "9r-admin-first" ? "1".repeat(64) : "2".repeat(64)}`,
      }),
    ]);

    expect(first.status).toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    expect(second.status).toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    expect(db.readData()).toMatchObject({
      adminApiKeyHash: `sha256:${"2".repeat(64)}`,
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    });
    expect(JSON.stringify(db.readData())).not.toContain(first.key);
    expect(JSON.stringify(db.readData())).not.toContain(second.key);
    expect(db.events).toEqual(["begin", "commit", "begin", "commit"]);
  });
});
