import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { buildCreateTableSql, TABLES } from "../../src/lib/db/schema.js";

const fx = vi.hoisted(() => ({ db: null, aliases: {} }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => fx.db }));
vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.aliases,
  getProviderNodes: async () => [],
  getComboByName: async (name) => {
    const repo = await import("../../src/lib/db/repos/combosRepo.js");
    return repo.getComboByName(name);
  },
}));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const { createCombo, deleteCombo, getComboById } = await import("../../src/lib/db/repos/combosRepo.js");
const { getApiKeyByKey } = await import("../../src/lib/db/repos/apiKeysRepo.js");
const { getKeyAccessContext, enforceKeyAccess, enforceKeyAccessProvider, filterModelsListForKey } =
  await import("../../src/sse/services/keyAccess.js");

beforeAll(async () => {
  // Real SQLite and repository/access code, never the user's DATA_DIR.
  fx.db = await createNodeSqliteAdapter(":memory:");
  for (const name of ["combos", "apiKeys"]) fx.db.exec(buildCreateTableSql(name, TABLES[name]));
});
afterAll(() => fx.db?.close());
beforeEach(() => {
  fx.db.exec("DROP TRIGGER IF EXISTS fail_key_update; DROP TRIGGER IF EXISTS fail_combo_delete;");
  fx.db.exec("DELETE FROM combos; DELETE FROM apiKeys;");
  fx.aliases = {};
});

function seedKey(id, allow, { restricted = 1, active = 1, raw = false } = {}) {
  fx.db.run(
    "INSERT INTO apiKeys (id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `sk-test-${id}`, `Key ${id}`, "test-machine", active, "2026-10-01T00:00:00Z", restricted, raw ? allow : JSON.stringify(allow)],
  );
}
const combo = (name = "Main") => createCombo({ name, models: ["openai/model-a"] });
const key = (id) => getApiKeyByKey(`sk-test-${id}`);
const rawKey = (id) => fx.db.get("SELECT * FROM apiKeys WHERE id = ?", [id]);
const context = (id) => getKeyAccessContext(new Request("http://localhost/v1/models", {
  headers: { Authorization: `Bearer sk-test-${id}` },
}));
async function status(id, model) {
  const response = await enforceKeyAccess(await context(id), model);
  return response?.status ?? 200;
}

describe("deleting a combo revokes its API-key grants", () => {
  it("removes the name case-insensitively from active and inactive restricted keys, preserving other fields and entries", async () => {
    const c = await combo();
    seedKey("mixed", ["other", " main ", "openai/model-a", "Mainly"]);
    seedKey("inactive", ["MAIN"], { active: 0 });
    const before = rawKey("mixed");

    expect(await deleteCombo(c.id)).toBe(true);
    expect(await getComboById(c.id)).toBeNull();
    expect(rawKey("mixed")).toEqual({ ...before, accessAllow: '["other","openai/model-a","Mainly"]' });
    expect((await key("inactive")).access).toEqual({ restricted: true, allow: [] });
    expect((await key("inactive")).isActive).toBe(false);
  });

  it("keeps a formerly combo-only key restricted and denies a recreated combo of the same name", async () => {
    const c = await combo();
    seedKey("combo", ["Main"]);
    expect(await status("combo", "Main")).toBe(200);
    await deleteCombo(c.id);
    await combo();
    expect(await status("combo", "Main")).toBe(403);
    expect((await key("combo")).access).toEqual({ restricted: true, allow: [] });
    expect(await filterModelsListForKey(await context("combo"), [
      { id: "Main", owned_by: "combo" }, { id: "openai/model-a", owned_by: "openai" },
    ])).toEqual([]);
  });

  it("does not reinterpret a deleted combo grant as a model alias", async () => {
    const c = await combo();
    fx.aliases.Main = "openai/model-b";
    seedKey("combo", ["Main"]);
    expect(await status("combo", "openai/model-b")).toBe(403);
    await deleteCombo(c.id);
    expect(await status("combo", "openai/model-b")).toBe(403);
    expect(await status("combo", "Main")).toBe(403);
  });

  it("does not reinterpret a deleted search combo grant as direct provider access", async () => {
    const c = await createCombo({ name: "tavily", kind: "webSearch", models: ["exa"] });
    seedKey("search", ["tavily"]);
    expect((await enforceKeyAccessProvider(await context("search"), "tavily", null)).status).toBe(403);
    await deleteCombo(c.id);
    expect((await enforceKeyAccessProvider(await context("search"), "tavily", null))?.status).toBe(403);
  });

  it("does not leak an alias-backed provider model into the catalog after deletion", async () => {
    const c = await combo();
    fx.aliases.Main = "openai/model-b";
    seedKey("combo", ["Main"]);
    await deleteCombo(c.id);
    expect(await filterModelsListForKey(await context("combo"), [
      { id: "openai/model-b", owned_by: "openai" },
    ])).toEqual([]);
  });

  it("rolls back the combo deletion and earlier key updates if any grant cleanup fails", async () => {
    const c = await combo();
    seedKey("first", ["Main", "other"]);
    seedKey("second", ["Main"]);
    fx.db.exec(`CREATE TRIGGER fail_key_update BEFORE UPDATE ON apiKeys
      WHEN OLD.id = 'second' BEGIN SELECT RAISE(ABORT, 'test cleanup failure'); END;`);
    await expect(deleteCombo(c.id)).rejects.toThrow("test cleanup failure");
    expect(await getComboById(c.id)).toEqual(c);
    expect((await key("first")).access.allow).toEqual(["Main", "other"]);
    expect((await key("second")).access.allow).toEqual(["Main"]);
  });

  it("leaves grants intact when deleting the combo fails", async () => {
    const c = await combo();
    seedKey("combo", ["Main"]);
    fx.db.exec(`CREATE TRIGGER fail_combo_delete BEFORE DELETE ON combos
      BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END;`);
    await expect(deleteCombo(c.id)).rejects.toThrow("test deletion failure");
    expect(await getComboById(c.id)).toEqual(c);
    expect((await key("combo")).access.allow).toEqual(["Main"]);
  });

  it("preserves an existing case-variant combo grant until the last matching combo is deleted", async () => {
    const first = await combo("Main");
    const second = await combo("MAIN");
    seedKey("combo", ["main"]);
    await deleteCombo(first.id);
    expect(await status("combo", "MAIN")).toBe(200);
    await deleteCombo(second.id);
    expect((await key("combo")).access).toEqual({ restricted: true, allow: [] });
  });

  it("does not treat the combo's database ID as an allow-list name", async () => {
    const c = await combo();
    seedKey("id", [c.id]);
    await deleteCombo(c.id);
    expect((await key("id")).access.allow).toEqual([c.id]);
  });

  it("leaves unrestricted, unrelated and malformed allow lists untouched", async () => {
    const c = await combo();
    seedKey("open", ["Main"], { restricted: 0 });
    seedKey("unrelated", ["other", "openai/Main"]);
    seedKey("invalid", "not json", { raw: true });
    seedKey("object", '{"Main":true}', { raw: true });
    seedKey("empty", []);
    const before = fx.db.all("SELECT * FROM apiKeys ORDER BY id");
    expect(await deleteCombo(c.id)).toBe(true);
    expect(fx.db.all("SELECT * FROM apiKeys ORDER BY id")).toEqual(before);
    expect(await status("invalid", "anything")).toBe(403);
  });

  it("returns false without changing keys when the combo does not exist", async () => {
    seedKey("combo", ["Main"]);
    const before = rawKey("combo");
    expect(await deleteCombo("missing")).toBe(false);
    expect(rawKey("combo")).toEqual(before);
  });
});
