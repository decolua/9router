// The usageHistory writer collapses a repeated save into the row it already
// holds. The match has to stay narrow: `timestamp` is an ISO string with
// millisecond resolution, so anything wider also swallows distinct requests
// that happen to share a millisecond.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-dedupe-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* windows keeps the sqlite file open */ }
});

const entry = (provider, extra = {}) => ({
  provider, model: "m", connectionId: "c1",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  status: "ok", ...extra,
});

describe("usageHistory row identity", () => {
  it("keeps every request that shares a millisecond with another", async () => {
    const timestamp = new Date().toISOString();
    const N = 25;
    await Promise.all(Array.from({ length: N }, () =>
      db.saveRequestUsage(entry("same-ms", { timestamp, endpoint: "/v1/chat" }))));

    const rows = await db.getUsageHistory({ provider: "same-ms" });
    // Matching on the value tuple alone kept exactly one of these.
    expect(rows.length).toBe(N);

    const stats = await db.getUsageStats("24h");
    expect(stats.byProvider["same-ms"].requests).toBe(N);
    expect(stats.byProvider["same-ms"].promptTokens).toBe(N * 10);
  });

  it("keeps them when they carry no endpoint either", async () => {
    const timestamp = new Date().toISOString();
    await Promise.all([
      db.saveRequestUsage(entry("no-endpoint", { timestamp })),
      db.saveRequestUsage(entry("no-endpoint", { timestamp })),
    ]);
    expect((await db.getUsageHistory({ provider: "no-endpoint" })).length).toBe(2);
  });

  it("still completes a row that was written without its endpoint", async () => {
    const timestamp = new Date().toISOString();
    await db.saveRequestUsage(entry("backfill", { timestamp }));
    await db.saveRequestUsage(entry("backfill", { timestamp, endpoint: "/v1/messages" }));

    const rows = await db.getUsageHistory({ provider: "backfill" });
    expect(rows.length).toBe(1);
    expect(rows[0].endpoint).toBe("/v1/messages");
  });

  it("does not fold a later request into an unrelated endpoint-less row", async () => {
    const timestamp = new Date().toISOString();
    await db.saveRequestUsage(entry("distinct", { timestamp, model: "a" }));
    await db.saveRequestUsage(entry("distinct", { timestamp, model: "b", endpoint: "/v1/chat" }));
    expect((await db.getUsageHistory({ provider: "distinct" })).length).toBe(2);
  });
});
