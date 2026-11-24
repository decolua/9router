// tests/unit/key-limit-db.test.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;
let adapter;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limit-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("schema", () => {
  it("apiKeys has limitUsd and limitWindow, and usageHistory has the (apiKey, timestamp) index", () => {
    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toContain("limitUsd");
    expect(cols).toContain("limitWindow");
    const idx = adapter.all(`PRAGMA index_list(usageHistory)`).map((i) => i.name);
    expect(idx).toContain("idx_uh_apikey_ts");
  });
});

describe("apiKeysRepo limit", () => {
  it("a new key has no limit; update sets, reads back and clears it; access updates keep it", async () => {
    const created = await db.createApiKey("limited", "machine-1");
    expect((await db.getApiKeyById(created.id)).limit).toBeNull();

    const set = await db.updateApiKey(created.id, { limit: { usd: 12.5, window: "month" } });
    expect(set.limit).toEqual({ usd: 12.5, window: "month" });
    expect((await db.getApiKeyByKey(created.key)).limit).toEqual({ usd: 12.5, window: "month" });

    const afterAccess = await db.updateApiKey(created.id, { access: { restricted: true, allow: ["Main"] } });
    expect(afterAccess.limit).toEqual({ usd: 12.5, window: "month" });

    const cleared = await db.updateApiKey(created.id, { limit: null });
    expect(cleared.limit).toBeNull();
  });
});

describe("backup export/import", () => {
  it("round-trips the limit; a backup without limit restores as no limit; a malformed limit is refused", async () => {
    const k = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(k.id, { access: { restricted: true, allow: ["Main"] }, limit: { usd: 7, window: "day" } });
    const dump = await db.exportDb();
    expect(dump.apiKeys.find((x) => x.id === k.id).limit).toEqual({ usd: 7, window: "day" });

    await db.importDb(dump);
    expect((await db.getApiKeyById(k.id)).limit).toEqual({ usd: 7, window: "day" });

    const legacy = { ...dump, apiKeys: dump.apiKeys.map(({ limit, ...rest }) => rest) };
    await db.importDb(legacy);
    expect((await db.getApiKeyById(k.id)).limit).toBeNull();

    const bad = { ...dump, apiKeys: dump.apiKeys.map((x) => ({ ...x, limit: { usd: -1, window: "day" } })) };
    await expect(db.importDb(bad)).rejects.toThrow(/limit/);
  });
});

describe("getKeySpendSince", () => {
  const usage = (apiKey, timestamp, completion) => ({
    provider: "openai", model: "gpt-4", connectionId: "c1", apiKey, timestamp,
    tokens: { prompt_tokens: 1000, completion_tokens: completion }, endpoint: "/v1/chat", status: "ok",
  });

  it("sums cost for one key from the window start inclusive, and ignores other keys and older rows", async () => {
    await db.saveRequestUsage(usage("sk-a", "2026-11-23T23:59:59.000Z", 100)); // before the window
    await db.saveRequestUsage(usage("sk-a", "2026-11-24T00:00:00.000Z", 200)); // exactly at the start
    await db.saveRequestUsage(usage("sk-a", "2026-11-24T10:00:00.000Z", 300));
    await db.saveRequestUsage(usage("sk-b", "2026-11-24T10:00:00.000Z", 999)); // other key

    const rows = adapter.all(`SELECT apiKey, timestamp, cost FROM usageHistory ORDER BY id`);
    const expected = rows.filter((r) => r.apiKey === "sk-a" && r.timestamp >= "2026-11-24T00:00:00.000Z")
      .reduce((s, r) => s + r.cost, 0);
    expect(expected).toBeGreaterThan(0); // gpt-4 is priced, so the test is meaningful

    expect(await db.getKeySpendSince("sk-a", "2026-11-24T00:00:00.000Z")).toBeCloseTo(expected, 10);
    expect(await db.getKeySpendSince("sk-none", "2026-11-24T00:00:00.000Z")).toBe(0);
  });
});
