import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let eventsMod;

let TMP;
beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsstats-"));
});
afterEach(() => {
  // Reset storage-dir override BEFORE deleting TMP so no later test writes
  // into a removed dir or inherits this test's override. Module ref is set
  // per test via dynamic import; guard covers a failed beforeEach/test.
  if (eventsMod) eventsMod.__setTokenSaverEventsDirForTest(null);
  fs.rmSync(TMP, { recursive: true, force: true });
});

function dayMs(n) {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

describe("tokenSaver stats read model", () => {
  it("windows all/today/yesterday/last7d/last30d count correctly", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    // two today
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 10 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "headroom", applied: true, tokensBefore: 1000, tokensAfter: 600, tokensSaved: 400, bodyBytesBefore: 1000, bodyBytesAfter: 800 });
    // one 8 days ago (only all + last30d)
    mod.appendTokenSaverEvent({ ts: dayMs(8), saver: "pxpipe", applied: true, tokensBeforeEst: 300, tokensAfterEst: 270, tokensSavedEst: 30, imageCount: 2, durationMs: 123 });
    const s = mod.getTokenSaverStats();
    expect(s.windows.all.requests).toBe(3);
    expect(s.windows.today.requests).toBe(2);
    expect(s.windows.last7d.proxyTokensSaved).toBe(400);
    expect(s.windows.last30d.estTokensSaved).toBe(30);
    expect(s.windows.all.charsReduced).toBe(10);
    expect(s.windows.all.estTokensSaved).toBe(30);
    expect(s.windows.yesterday.requests).toBe(0);
  });

  it("UTC daily timeline buckets with correct length and sums", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 5 });
    const s = mod.getTokenSaverStats({ timelineDays: 7 });
    expect(s.timeline).toHaveLength(7);
    for (const row of s.timeline) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(row.date)).toBe(true);
      expect(typeof row.charsReduced).toBe("number");
      expect(typeof row.proxyTokensSaved).toBe("number");
      expect(typeof row.estTokensSaved).toBe("number");
    }
    expect(s.timeline.reduce((a, b) => a + b.requests, 0)).toBeGreaterThanOrEqual(1);
    expect(new Date(s.timeline.at(-1).date + "T00:00:00Z").toISOString().slice(0, 10)).toBe(new Date(Date.now()).toISOString().slice(0, 10));
  });

  it("query clamp: sinceMs non-finite ignored, timelineDays and recentLimit clamped", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    for (let i = 0; i < 600; i++) mod.appendTokenSaverEvent({ ts: Date.now() + i, saver: "rtk", applied: true, charsSaved: 1 });
    const s1 = mod.getTokenSaverStats({ sinceMs: NaN, timelineDays: -5, recentLimit: 900 });
    expect(s1.recent.length).toBe(500);
    expect(s1.timeline.length).toBeGreaterThan(0);
    expect(s1.timeline.length).toBeLessThanOrEqual(90);
    const s2 = mod.getTokenSaverStats({ timelineDays: 4 });
    expect(s2.timeline.length).toBe(4);
    const s3 = mod.getTokenSaverStats({ timelineDays: 200 });
    expect(s3.timeline.length).toBeLessThanOrEqual(90);
    expect(s3.recent.length).toBeLessThanOrEqual(500);
    const s4 = mod.getTokenSaverStats({ recentLimit: -1 });
    expect(s4.recent.length).toBe(0);
    const s5 = mod.getTokenSaverStats({ sinceMs: Infinity });
    expect(s5.windows.all.requests).toBe(600);
  });

  it("recent cap 500 and newest-first while file on disk stays chronological", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    for (let i = 0; i < 600; i++) mod.appendTokenSaverEvent({ ts: 1_000 + i, saver: "rtk", applied: true, charsSaved: 1 });
    const s = mod.getTokenSaverStats({ recentLimit: 500 });
    expect(s.recent.length).toBe(500);
    expect(s.recent[0].ts).toBeGreaterThan(s.recent.at(-1).ts);
    const raw = mod.readTokenSaverEvents();
    for (let i = 1; i < raw.length; i++) expect(raw[i].ts >= raw[i - 1].ts).toBe(true);
    const s2 = mod.getTokenSaverStats({ recentLimit: 900 });
    expect(s2.recent.length).toBe(500);
  });

  it("never sums unlike units — exposes per-unit fields only", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 100 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "headroom", applied: true, tokensSaved: 100, bodyBytesBefore: 5000, bodyBytesAfter: 4500 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "pxpipe", applied: true, tokensSavedEst: 100 });
    const s = mod.getTokenSaverStats();
    expect(s.windows.all).not.toHaveProperty("totalSaved");
    expect(s.windows.all).not.toHaveProperty("tokensSaved");
    expect(s.windows.all).not.toHaveProperty("savedPct");
    expect(s.windows.all).not.toHaveProperty("totalChars");
    expect(s.windows.all.charsReduced).toBe(100);
    expect(s.windows.all.proxyTokensSaved).toBe(100);
    expect(s.windows.all.bodyBytesReduced).toBe(500);
    expect(s.windows.all.estTokensSaved).toBe(100);
  });

  it("zero-savings headroom request counts in headroomRequests without inventing savings", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "headroom", applied: true, tokensSaved: 0, bodyBytesBefore: 100, bodyBytesAfter: 100 });
    const s = mod.getTokenSaverStats();
    expect(s.windows.all.headroomRequests).toBe(1);
    expect(s.windows.today.headroomRequests).toBe(1);
    // savings stay truthful zero — activity is not conflated with savings
    expect(s.windows.all.proxyTokensSaved).toBe(0);
    expect(s.windows.all.bodyBytesReduced).toBe(0);
  });

  it("non-headroom savers never bump headroomRequests", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 5 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "pxpipe", applied: true, tokensSavedEst: 7 });
    const s = mod.getTokenSaverStats();
    expect(s.windows.all.requests).toBe(2);
    expect(s.windows.all.headroomRequests).toBe(0);
  });

  it("grouping is O(rows + days), not O(days * rows) — single-pass bucket assignment", async () => {
    const mod = (eventsMod = await import("@/lib/tokenSaver/events.js"));
    const src = fs.readFileSync(new URL("../../src/lib/tokenSaver/events.js", import.meta.url), "utf8");
    // timeline is built via a single Map lookup per row, not nested filter per day
    expect(src).not.toMatch(/timelineDays[\s\S]*filtered\.filter/);
  });

  it("timeline rows use UTC (toISOString), not local getDate", async () => {
    const src = fs.readFileSync(new URL("../../src/lib/tokenSaver/events.js", import.meta.url), "utf8");
    expect(src).toMatch(/toISOString/);
    expect(src).not.toMatch(/getDate\(\)|getMonth\(\)|LocalDate/);
  });
});
