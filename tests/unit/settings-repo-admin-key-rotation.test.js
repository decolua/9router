import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseJson } from "../../src/lib/db/helpers/jsonCol.js";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

const { rotateAdminApiKeySettings } = await import("../../src/lib/db/repos/settingsRepo.js");

function hashFor(key) {
  return `sha256:${key === "9r-admin-first" ? "1".repeat(64) : "2".repeat(64)}`;
}

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

  it("rejects stale expected versions before generating plaintext keys", async () => {
    const db = createDb({});
    mocks.getAdapter.mockResolvedValue(db);
    const generateKey = vi.fn()
      .mockReturnValueOnce("9r-admin-first")
      .mockReturnValueOnce("9r-admin-second");

    const [first, second] = await Promise.allSettled([
      rotateAdminApiKeySettings({
        now: new Date("2026-06-23T00:00:00.000Z"),
        expectedUpdatedAt: "",
        generateKey,
        hashKey: hashFor,
      }),
      rotateAdminApiKeySettings({
        now: new Date("2026-06-24T00:00:00.000Z"),
        expectedUpdatedAt: "",
        generateKey,
        hashKey: hashFor,
      }),
    ]);

    const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
    const rejected = [first, second].filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(rejected[0].reason).toMatchObject({
      name: "AdminApiKeyRotationConflictError",
      code: "ADMIN_API_KEY_ROTATION_CONFLICT",
      currentUpdatedAt: "2026-06-23T00:00:00.000Z",
      expectedUpdatedAt: "",
    });
    expect(db.readData().adminApiKeyHash).toBe(hashFor(fulfilled[0].value.key));
    expect(JSON.stringify(rejected[0].reason)).not.toContain("9r-admin-");
  });
});
