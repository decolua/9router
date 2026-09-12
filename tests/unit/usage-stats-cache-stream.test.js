// Phase 3 — stats cache (per period, invalidated on write), the 60-day cap on
// "all", and the lightweight SSE stream payload (single shared broadcast).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-stats-cache-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getUsageStats cache", () => {
  it("returns the cached object within the TTL and recomputes after a write", async () => {
    const first = await db.getUsageStats("30d");
    const second = await db.getUsageStats("30d");
    expect(second).toBe(first); // same object → cached

    await db.saveRequestUsage({
      provider: "cache-prov", model: "m-cache",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
    });
    const third = await db.getUsageStats("30d");
    expect(third).not.toBe(first); // write cleared the cache
    expect(third.byProvider["cache-prov"].requests).toBe(1);
  });

  it("caches periods independently", async () => {
    const d7 = await db.getUsageStats("7d");
    const dAll = await db.getUsageStats("all");
    expect(dAll).not.toBe(d7);
    expect(await db.getUsageStats("7d")).toBe(d7);
  });
});

describe("'all' is capped at the 60-day horizon", () => {
  it("excludes rollup rows older than 60 days", async () => {
    const ancient = new Date(Date.now() - 70 * 86400000).toISOString();
    await db.saveRequestUsage({
      provider: "ancient-prov", model: "m-old",
      tokens: { prompt_tokens: 5, completion_tokens: 1 },
      timestamp: ancient,
    });

    // the rollup row exists — only the read path caps it
    const { getAdapter } = await import("@/lib/db/driver.js");
    const a = await getAdapter();
    const raw = a.get(`SELECT SUM(requests) n FROM usageRollupDaily WHERE dimension = 'provider' AND dimKey = 'ancient-prov'`);
    expect(raw.n).toBe(1);

    for (const period of ["all", "60d"]) {
      const stats = await db.getUsageStats(period);
      expect(stats.byProvider["ancient-prov"]).toBeUndefined();
    }
  });
});

describe("usage SSE stream", () => {
  async function readDataEvent(reader, timeoutMs = 3000) {
    const decoder = new TextDecoder();
    const deadline = Date.now() + timeoutMs;
    let buffer = "";
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ value: undefined, done: true }), deadline - Date.now())),
      ]);
      if (done || !value) break;
      buffer += decoder.decode(value, { stream: true });
      const m = buffer.match(/^data: (.+)\n\n/m);
      if (m) return JSON.parse(m[1]);
    }
    throw new Error(`no data event in ${buffer.length} bytes`);
  }

  it("sends only the lightweight live payload and refreshes on pending changes", async () => {
    const { GET } = await import("@/app/api/usage/stream/route.js");
    const res = await GET();
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body.getReader();
    const first = await readDataEvent(reader);
    // exactly the fields the client merges — no full-stats blob
    expect(Object.keys(first).sort()).toEqual(["activeRequests", "errorProvider", "pending", "recentRequests"]);

    const { trackPendingRequest } = await import("@/lib/usageDb");
    trackPendingRequest("m-stream", "prov-stream", "conn-stream", true);
    const second = await readDataEvent(reader);
    expect(second.activeRequests).toEqual([
      { model: "m-stream", provider: "prov-stream", account: expect.any(String), count: 1 },
    ]);

    trackPendingRequest("m-stream", "prov-stream", "conn-stream", false);
    await reader.cancel();
  });
});
