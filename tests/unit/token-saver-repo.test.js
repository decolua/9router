// RED phase: module/functions don't exist yet — these imports fail at call time
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

// Run against real SQLite test DB (not mocks), same pattern as db-*.test.js
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ts-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("TokenSaver repository", () => {
  /** @type {import("@/lib/db/index.js")} */
  let db;

  beforeEach(async () => {
    db = await import("@/lib/db/index.js");
  });

  it("recordTokenSaverEvent and getTokenSaverStats exist as functions", () => {
    expect(typeof db.recordTokenSaverEvent).toBe("function");
    expect(typeof db.getTokenSaverStats).toBe("function");
  });

  it("records one event into daily aggregate", async () => {
    await db.recordTokenSaverEvent({
      requestsObserved: 5,
      rtkRequestsWithHits: 2,
      rtkHits: 3,
      rtkBytesBefore: 1000,
      rtkBytesAfter: 600,
      rtkBytesSaved: 400,
      headroomState: "compressed",
      headroomTokensBefore: 500,
      headroomTokensAfter: 300,
      headroomTokensSaved: 200,
      headroomBodyBytesBefore: 2000,
      headroomBodyBytesAfter: 1500,
      headroomMessageBytesBefore: 100,
      headroomMessageBytesAfter: 80,
    });

    const stats = await db.getTokenSaverStats("today");
    expect(stats.requestsObserved).toBe(5);
    expect(stats.rtk.requestsWithHits).toBe(2);
    expect(stats.rtk.hits).toBe(3);
    expect(stats.rtk.bytesBefore).toBe(1000);
    expect(stats.rtk.bytesAfter).toBe(600);
    expect(stats.rtk.bytesSaved).toBe(400);
    expect(stats.headroom.compressed).toBe(1);
    expect(stats.headroom.tokensBefore).toBe(500);
    expect(stats.headroom.tokensAfter).toBe(300);
    expect(stats.headroom.tokensSaved).toBe(200);
    expect(stats.headroom.bodyBytesBefore).toBe(2000);
    expect(stats.headroom.bodyBytesAfter).toBe(1500);
    expect(stats.headroom.messageBytesBefore).toBe(100);
    expect(stats.headroom.messageBytesAfter).toBe(80);
    // actualBytesSaved = rtk.bytesSaved + (bodyBytesBefore - bodyBytesAfter)
    expect(stats.totals.actualBytesSaved).toBe(400 + (2000 - 1500));
    expect(stats.dailyPoints).toEqual([expect.objectContaining({
      actualBytesSaved: 900,
      rtkBytesSaved: 400,
      headroomBytesSaved: 500,
      headroomCompressed: 1,
    })]);
  });

  it("accumulates two events on same day", async () => {
    await db.recordTokenSaverEvent({
      requestsObserved: 3,
      rtkRequestsWithHits: 1,
      rtkHits: 2,
      rtkBytesSaved: 100,
      headroomState: "compressed",
      headroomTokensBefore: 200,
      headroomTokensAfter: 150,
      headroomTokensSaved: 50,
      headroomBodyBytesBefore: 500,
      headroomBodyBytesAfter: 400,
    });
    await db.recordTokenSaverEvent({
      requestsObserved: 7,
      rtkRequestsWithHits: 3,
      rtkHits: 5,
      rtkBytesSaved: 300,
      headroomState: "compressed",
      headroomTokensBefore: 800,
      headroomTokensAfter: 600,
      headroomTokensSaved: 200,
      headroomBodyBytesBefore: 1500,
      headroomBodyBytesAfter: 1200,
    });

    const stats = await db.getTokenSaverStats("today");
    expect(stats.requestsObserved).toBe(10);
    expect(stats.rtk.requestsWithHits).toBe(4);
    expect(stats.rtk.hits).toBe(7);
    expect(stats.rtk.bytesSaved).toBe(400);
    expect(stats.headroom.compressed).toBe(2);
    expect(stats.headroom.tokensBefore).toBe(1000);
    expect(stats.headroom.tokensAfter).toBe(750);
    expect(stats.headroom.tokensSaved).toBe(250);
    expect(stats.headroom.bodyBytesBefore).toBe(2000);
    expect(stats.headroom.bodyBytesAfter).toBe(1600);
  });

  it("disabled/skipped state never increases Headroom reported token savings", async () => {
    // First event: compressed with real savings
    await db.recordTokenSaverEvent({
      requestsObserved: 1,
      headroomState: "compressed",
      headroomTokensBefore: 1000,
      headroomTokensAfter: 700,
      headroomTokensSaved: 300,
      headroomBodyBytesBefore: 5000,
      headroomBodyBytesAfter: 3500,
    });
    // Second event: disabled — should NOT add to headroom savings fields
    await db.recordTokenSaverEvent({
      requestsObserved: 1,
      headroomState: "disabled",
      headroomTokensBefore: 0,
      headroomTokensAfter: 0,
      headroomTokensSaved: 0,
      headroomBodyBytesBefore: 0,
      headroomBodyBytesAfter: 0,
    });
    // Third event: skipped — should NOT add to headroom savings fields
    await db.recordTokenSaverEvent({
      requestsObserved: 1,
      headroomState: "skipped",
      headroomTokensBefore: 999,  // should be zeroed
      headroomTokensAfter: 999,   // should be zeroed
      headroomTokensSaved: 999,   // should be zeroed
      headroomBodyBytesBefore: 999,
      headroomBodyBytesAfter: 999,
      headroomDiagnostic: "timeout",
    });

    const stats = await db.getTokenSaverStats("today");
    // Savings from compressed event only
    expect(stats.headroom.compressed).toBe(1);
    expect(stats.headroom.disabled).toBe(1);
    expect(stats.headroom.skipped).toBe(1);
    expect(stats.headroom.tokensSaved).toBe(300);
    expect(stats.headroom.tokensBefore).toBe(1000);
    expect(stats.headroom.tokensAfter).toBe(700);
    expect(stats.headroom.bodyBytesBefore).toBe(5000);
    expect(stats.headroom.bodyBytesAfter).toBe(3500);
    // phantomSavings only from non-compressed events — but disabled/skipped
    // had 0 phantomSavings, so total remains 0
    expect(stats.headroom.phantomSavings).toBe(0);
    // skipReasons: timeout from skipped event
    expect(stats.headroom.skipReasons.timeout).toBe(1);
  });

  it("malformed negative/NaN values become zero", async () => {
    await db.recordTokenSaverEvent({
      requestsObserved: -5,
      rtkRequestsWithHits: NaN,
      rtkHits: -3,
      rtkBytesSaved: "not-a-number",
      headroomState: "disabled",
      headroomTokensSaved: -100,
    });

    const stats = await db.getTokenSaverStats("today");
    expect(stats.requestsObserved).toBe(0);
    expect(stats.rtk.requestsWithHits).toBe(0);
    expect(stats.rtk.hits).toBe(0);
    expect(stats.rtk.bytesSaved).toBe(0);
    expect(stats.headroom.tokensSaved).toBe(0);
  });

  it("prunes day data older than 365 days after recording", async () => {
    // Seed a row 400 days in the past directly in DB
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 400);
    const pastKey = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}-${String(pastDate.getDate()).padStart(2, "0")}`;

    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    adapter.run(
      `INSERT INTO tokenSaverDaily(dateKey, data) VALUES(?, ?)`,
      [pastKey, JSON.stringify({ requestsObserved: 99, rtk: {}, headroom: {}, totals: {} })]
    );

    // Record today's event (triggers prune)
    await db.recordTokenSaverEvent({ requestsObserved: 1, headroomState: "disabled" });

    // Past row should be gone
    const rows = adapter.all(`SELECT * FROM tokenSaverDaily`);
    const dateKeys = rows.map((r) => r.dateKey);
    expect(dateKeys).not.toContain(pastKey);
    expect(dateKeys.length).toBe(1); // only today's row
  });

  it("returns data for valid periods", async () => {
    // Record an event
    await db.recordTokenSaverEvent({ requestsObserved: 3, headroomState: "disabled" });

    for (const period of ["today", "24h", "7d", "30d", "60d", "365d"]) {
      const stats = await db.getTokenSaverStats(period);
      expect(stats.requestsObserved).toBe(3);
      expect(typeof stats.rtk).toBe("object");
      expect(typeof stats.headroom).toBe("object");
      expect(typeof stats.totals).toBe("object");
      expect(stats.totals.actualBytesSaved).toBeTypeOf("number");
    }
  });

  it("throws on invalid period", async () => {
    await expect(db.getTokenSaverStats("all")).rejects.toThrow();
    await expect(db.getTokenSaverStats("invalid")).rejects.toThrow();
  });

  it("data contains no raw diagnostic string/URL", async () => {
    await db.recordTokenSaverEvent({
      requestsObserved: 1,
      headroomState: "skipped",
      headroomDiagnostic: "http-error",
    });
    await db.recordTokenSaverEvent({
      requestsObserved: 1,
      headroomState: "skipped",
      headroomDiagnostic: "something-unexpected-here",
    });

    const stats = await db.getTokenSaverStats("today");
    // skipReasons only has safe category keys with counts
    expect(stats.headroom.skipReasons["http-error"]).toBe(1);
    expect(stats.headroom.skipReasons["other-skip"]).toBe(1);
    // No raw string "something-unexpected-here" anywhere in serialized stats
    const json = JSON.stringify(stats);
    expect(json).not.toContain("something-unexpected-here");
    expect(json).not.toContain("http://");
    expect(json).not.toContain("https://");
    expect(json).not.toContain(".com");
  });

  it("unknown/missing headroomState is dropped — no row, no counter inflation", async () => {
    // Unknown state must NOT default to "skipped" (which would inflate metrics)
    await db.recordTokenSaverEvent({
      requestsObserved: 5,
      headroomState: "bogus-state",
    });
    // Missing state entirely — same treatment
    await db.recordTokenSaverEvent({ requestsObserved: 7 });

    // No daily row recorded at all
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const rows = adapter.all(`SELECT * FROM tokenSaverDaily`);
    expect(rows.length).toBe(0);

    // Aggregated stats stay empty — no skipped/requestsObserved inflation
    const stats = await db.getTokenSaverStats("today");
    expect(stats.requestsObserved).toBe(0);
    expect(stats.headroom.skipped).toBe(0);
    expect(stats.headroom.compressed).toBe(0);
    expect(stats.headroom.disabled).toBe(0);
  });

  it("recordTokenSaverEvent catches its own errors (fail-open)", async () => {
    // Should not throw despite bad args
    await expect(db.recordTokenSaverEvent(null)).resolves.toBeUndefined();
    await expect(db.recordTokenSaverEvent(undefined)).resolves.toBeUndefined();
    await expect(db.recordTokenSaverEvent("bad")).resolves.toBeUndefined();
  });
});
