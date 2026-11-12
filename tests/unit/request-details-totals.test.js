// Totals footer behind /api/usage/request-details.
//
// The table pages, but the footer must summarise the WHOLE filtered window,
// so these cases pin two properties that are easy to get wrong:
//   1. the aggregate ignores LIMIT/OFFSET (page 2 totals equal page 1 totals)
//   2. it honours every filter the table honours (provider / connectionId / dates)
// plus the field names: the handlers store `cache_read_input_tokens`, not the
// OpenAI-style `cached_tokens`, so a wrong name silently reports 0.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

function insertDetail({ id, timestamp, provider = "opendesign-go", connectionId = null, tokens = {}, latency = {} }) {
  adapter.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      timestamp,
      provider,
      "deepseek-v4.1-flash-eco",
      connectionId,
      "success",
      JSON.stringify({ id, timestamp, provider, model: "deepseek-v4.1-flash-eco", connectionId, status: "success", tokens, latency }),
    ]
  );
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-details-totals-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();

  // Two providers, two connections, three timestamps, deliberately unequal
  // values so a filter bug shows up as a wrong sum rather than a coincidence.
  insertDetail({
    id: "t1", timestamp: "2026-11-12T01:00:00.000Z", provider: "opendesign-go",
    connectionId: "conn-a",
    tokens: { prompt_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 200, completion_tokens: 100 },
    latency: { ttft: 2000, total: 10000 },
  });
  insertDetail({
    id: "t2", timestamp: "2026-11-12T02:00:00.000Z", provider: "opendesign-go",
    connectionId: "conn-b",
    tokens: { prompt_tokens: 3000, cache_read_input_tokens: 1500, cache_creation_input_tokens: 400, completion_tokens: 300 },
    latency: { ttft: 4000, total: 30000 },
  });
  insertDetail({
    id: "t3", timestamp: "2026-11-12T03:00:00.000Z", provider: "claude",
    connectionId: "conn-c",
    tokens: { prompt_tokens: 5000, cache_read_input_tokens: 2500, cache_creation_input_tokens: 600, completion_tokens: 500 },
    latency: { ttft: 6000, total: 50000 },
  });
});

afterAll(() => {
  // Windows keeps the SQLite file mapped for a moment after the adapter closes,
  // so an immediate recursive rm throws EPERM and would fail the whole file
  // even though every assertion passed. Leaking the temp dir is harmless here.
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best-effort cleanup only */
    }
  }
});

describe("getRequestDetailsTotals", () => {
  it("sums every row across all pages, not just the current page", async () => {
    const page1 = await db.getRequestDetailsTotals({ page: 1, pageSize: 1 });
    const page2 = await db.getRequestDetailsTotals({ page: 2, pageSize: 1 });

    expect(page1).toEqual(page2);
    expect(page1).toMatchObject({
      requests: 3,
      inputTokens: 9000,
      cachedTokens: 4500,
      cacheCreationTokens: 1200,
      outputTokens: 900,
      latencyTotalMs: 90000,
      latencyTtftMs: 12000,
    });
  });

  it("honours the provider filter", async () => {
    const totals = await db.getRequestDetailsTotals({ provider: "opendesign-go" });

    expect(totals).toMatchObject({
      requests: 2,
      inputTokens: 4000,
      cachedTokens: 2000,
      outputTokens: 400,
      latencyTotalMs: 40000,
    });
  });

  it("honours the connectionId filter so two accounts split cleanly", async () => {
    const totals = await db.getRequestDetailsTotals({ connectionId: "conn-b" });

    expect(totals).toMatchObject({ requests: 1, inputTokens: 3000, outputTokens: 300 });
  });

  it("honours the date range", async () => {
    const totals = await db.getRequestDetailsTotals({
      startDate: "2026-11-12T01:30:00.000Z",
      endDate: "2026-11-12T04:00:00.000Z",
    });

    // Drops t1, keeps t2 + t3.
    expect(totals).toMatchObject({ requests: 2, inputTokens: 8000, outputTokens: 800 });
  });

  it("returns zeros (not NaN/null fields) for an empty match", async () => {
    const totals = await db.getRequestDetailsTotals({ provider: "does-not-exist" });

    expect(totals).toEqual({
      requests: 0,
      inputTokens: 0,
      cachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      latencyTotalMs: 0,
      latencyTtftMs: 0,
    });
  });
});
