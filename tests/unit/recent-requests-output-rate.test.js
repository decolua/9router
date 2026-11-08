// Recent Requests shows each streamed request's output rate (tok/s). The panel
// reads usageHistory — the in-memory ring on live updates, the table on a full
// stats load — so the stream latency has to survive both paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-output-rate-"));
  process.env.DATA_DIR = tempDir;
  global._recentRing = undefined;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  global._recentRing = undefined;
});

const streamed = {
  provider: "openai", model: "gpt-4", connectionId: "c1",
  tokens: { prompt_tokens: 10, completion_tokens: 301 },
  latency: { ttft: 500, total: 2600, generation: 2000, maxGap: 300 },
};

describe("Recent Requests output rate", () => {
  it("reports tok/s on the live (ring) path", async () => {
    await db.saveRequestUsage({ ...streamed });
    const { recentRequests } = await db.getActiveRequests();
    expect(recentRequests[0].outputRate).toBe(150);
  });

  it("reports tok/s on the full stats load", async () => {
    await db.saveRequestUsage({ ...streamed });
    const { recentRequests } = await db.getUsageStats("24h");
    expect(recentRequests[0].outputRate).toBe(150);
  });

  it("reports tok/s after a restart reloads the ring from the table", async () => {
    await db.saveRequestUsage({ ...streamed });
    global._recentRing = undefined;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    const { recentRequests } = await db.getActiveRequests();
    expect(recentRequests[0].outputRate).toBe(150);
  });

  it("leaves the rate empty when no latency was recorded", async () => {
    await db.saveRequestUsage({ ...streamed, latency: undefined });
    const { recentRequests } = await db.getActiveRequests();
    expect(recentRequests[0].outputRate).toBeNull();
  });
});
