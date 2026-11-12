import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory;
let database;
let driver;
let state;
const originalDataDir = process.env.DATA_DIR;
const originalAdapter = global._dbAdapter;
const jwt = (subject) => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: subject, iss: "https://fixture.example" })).toString("base64url")}.fixture`;
const card = { cardId: "card-original", source_type: " original-source ", out_biz_no: " original-business ", type: "FULL", expiresAt: "2099-01-01T00:00:00.000Z" };

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "9router-reset-persistence-"));
  process.env.DATA_DIR = directory;
  delete global._dbAdapter;
  vi.resetModules();
  database = await import("../../src/lib/db/index.js");
  driver = await import("../../src/lib/db/driver.js");
  state = await import("../../src/lib/miniMaxResetState.js");
  await database.initDb();
});

afterAll(async () => {
  if (driver) (await driver.getAdapter()).close();
  global._dbAdapter = originalAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("MiniMax recovery persisted in native SQLite", () => {
  it("survives a fresh database connection and credential refresh without replacing the native card identity", async () => {
    const adapter = await driver.getAdapter();
    expect(adapter.driver).not.toBe("sql.js");
    const connection = await database.createProviderConnection({ provider: "minimax-code-global", authType: "oauth", accessToken: jwt("account-original"), refreshToken: "fixture-refresh", name: "Fixture", providerSpecificData: { keep: true } });
    const key = state.miniMaxAccountKey(connection.accessToken);
    const pending = state.createMiniMaxResetPending(key, card);
    await state.writeMiniMaxResetPending(connection.id, key, null, pending);
    await database.updateProviderConnection(connection.id, { accessToken: jwt("account-original"), refreshToken: "rotated-fixture", displayName: "Updated", providerSpecificData: { keep: "updated" } });

    const { DatabaseSync } = await import("node:sqlite");
    const disk = new DatabaseSync(join(directory, "db", "data.sqlite"), { readOnly: true });
    try {
      const row = disk.prepare("SELECT data FROM providerConnections WHERE id = ?").get(connection.id);
      expect(JSON.parse(row.data)).toMatchObject({ miniMaxResetPending: pending, refreshToken: "rotated-fixture", displayName: "Updated", providerSpecificData: { keep: "updated" } });
    } finally {
      disk.close();
    }

    await state.writeMiniMaxResetPending(connection.id, key, pending, { ...pending, state: "refreshing" });
    await state.writeMiniMaxResetPending(connection.id, key, { ...pending, state: "refreshing" }, null);
    const finished = await database.getProviderConnectionById(connection.id);
    expect(finished.miniMaxResetPending).toBeNull();
    expect(finished.providerSpecificData).toEqual({ keep: "updated" });
    expect(finished.refreshToken).toBe("rotated-fixture");
  });

  it("atomically refuses a second claim and rejects account changes without clearing recovery", async () => {
    const connection = await database.createProviderConnection({ provider: "minimax-code-global", authType: "oauth", accessToken: jwt("account-two"), name: "Second fixture" });
    const key = state.miniMaxAccountKey(connection.accessToken);
    const first = state.createMiniMaxResetPending(key, card);
    const second = state.createMiniMaxResetPending(key, { ...card, cardId: "other", out_biz_no: "other" });
    const claims = await Promise.allSettled([
      state.writeMiniMaxResetPending(connection.id, key, null, first),
      state.writeMiniMaxResetPending(connection.id, key, null, second),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect((await database.getProviderConnectionById(connection.id)).miniMaxResetPending).toEqual(first);
    await database.updateProviderConnection(connection.id, { accessToken: jwt("different-account") });
    await expect(state.writeMiniMaxResetPending(connection.id, key, first, null)).rejects.toMatchObject({ code: "account_changed" });
    expect((await database.getProviderConnectionById(connection.id)).miniMaxResetPending).toEqual(first);
  });
});
