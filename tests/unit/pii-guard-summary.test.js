import { describe, it, expect } from "vitest";
import { summarize } from "../../src/lib/piiGuard/summary.js";

describe("summarize", () => {
  it("groups recent values, counts actions, sources, ignores, warnings, and errors", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    const hit = { hash: "012345abcdef", rule: "known", name: "Secret", kind: "known", source: "assistant/thinking", action: "leaked", where: "assistant/thinking" };
    const result = summarize([
      { ts: "2026-01-01T23:00:00.000Z", hits: [hit] },
      { ts: "2026-01-01T23:30:00.000Z", hits: [{ ...hit, action: "block", source: "user/-", where: undefined }] },
      { ts: "2026-01-01T23:40:00.000Z", type: "error" },
      { ts: "2025-12-31T00:00:00.000Z", hits: [{ ...hit, hash: "old-value-000" }] },
    ], { now, ignore: [hit.hash] });

    expect(result.unique24h).toBe(1);
    expect(result.byRule.known).toEqual({ unique: 1, hits: 2 });
    expect(result.bySource).toEqual({ "assistant/thinking": 1, "user/-": 1 });
    expect(result.leaked24h).toBe(1);
    expect(result.blocked24h).toBe(1);
    expect(result.errors24h).toBe(1);
    expect(result.groups[0]).toMatchObject({ hash: hit.hash, turns: 2, ignored: true, actions: ["block", "leaked"], action: "block", leakedWhere: ["assistant/thinking"] });
    expect(result.ruleWarnings.known).toMatchObject({ topSource: "assistant/thinking", share: 0.5 });
  });
});

it("counts a leak even when the same value was redacted earlier in the event", () => {
  const ts = new Date().toISOString();
  const r = summarize([{ ts, hits: [{ hash: "aaaaaaaaaaaa", rule: "email", source: "user/text", action: "redact" }, { hash: "aaaaaaaaaaaa", rule: "email", source: "user/image", action: "leaked" }] }], { now: Date.now() });
  expect(r.leaked24h).toBe(1);
});

it("does not warn for places Redact can rewrite", () => {
  const ts = new Date().toISOString();
  const r = summarize([{ ts, hits: [{ hash: "bbbbbbbbbbbb", rule: "email", source: "assistant/tool_use", action: "observe" }] }], { now: Date.now() });
  expect(r.ruleWarnings).toEqual({});
});

describe("OCR test events", () => {
  it("excludes test hits and returns newest OCR rows and reason counts", () => {
    const now = Date.parse("2026-01-02T12:00:00.000Z");
    const events = [
      { ts: "2026-01-02T10:00:00.000Z", type: "test", test: true, hits: [{ hash: "testhash0000", rule: "pan", source: "test/text", action: "observe" }] },
      { ts: "2026-01-02T10:01:00.000Z", type: "ocr", requestId: "one", model: "m", endpoint: "/v1/chat", imageIndex: 0, status: "skipped", reason: "queue_full", cache: "none", ocrMs: 0, mode: "basic", hits: [{ hash: "hash00000001", rule: "pan", name: "PAN", action: "observe" }, { hash: "hash00000002", rule: "email", action: "ignored" }] },
      { ts: "2026-01-02T10:02:00.000Z", type: "ocr", requestId: "two", status: "failed", reason: "queue_full", hits: [] },
    ];
    const result = summarize(events, { now });
    expect(result.requests).toBe(0);
    expect(result.unique24h).toBe(2);
    expect(result.byRule.pan.hits).toBe(1);
    expect(result.byRule.email.hits).toBe(1);
    expect(result.ocr.totalImages).toBe(2);
    expect(result.ocr.reasons).toEqual({ queue_full: 2 });
    expect(result.ocr.recent[0].requestId).toBe("two");
    expect(result.ocr.recent[1].rules).toEqual(["PAN"]);
  });
});

describe("summarize range", () => {
  it("honours since/until", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    const events = [
      { ts: "2026-01-01T23:00:00.000Z", hits: [{ hash: "a", rule: "r", source: "user/text", action: "observe" }] },
      { ts: "2026-01-01T20:00:00.000Z", hits: [{ hash: "b", rule: "r", source: "user/text", action: "observe" }] },
    ];
    const r = summarize(events, { since: now - 2*60*60*1000, until: now, now });
    expect(r.unique24h).toBe(1);
    expect(r.range.from).toBe(now - 2*60*60*1000);
  });
});

describe("summarize trend", () => {
  it("buckets hits by step and counts leaks per bucket", () => {
    const hit = (action) => ({ hash: "aaaaaaaaaaaa", rule: "pan", source: "user/text", action });
    const events = [
      { ts: "2026-11-06T00:10:00.000Z", ua: "claude-cli/2", model: "opus", hits: [hit("redact")] },
      { ts: "2026-11-06T01:20:00.000Z", hits: [hit("leaked")] },
    ];
    const r = summarize(events, { since: Date.parse("2026-11-06T00:00:00Z"), until: Date.parse("2026-11-06T03:00:00Z"), step: 36e5, origin: Date.parse("2026-11-06T00:00:00Z") });
    expect(r.trend).toEqual([{ hits: 1, leaks: 0 }, { hits: 1, leaks: 1 }, { hits: 0, leaks: 0 }]);
    expect(r.actionHits).toEqual({ redact: 1, leaked: 1 });
    expect(r.groups[0]).toMatchObject({ ua: "claude-cli/2", model: "opus" });
  });
});

describe("summary OCR recent list", () => {
  it("keeps only the newest 20 OCR records, even across the batch trim", () => {
    const base = Date.now() - 3600e3;
    const events = Array.from({ length: 450 }, (_, i) => ({ type: "ocr", ts: new Date(base + i * 1000).toISOString(), status: "scanned", cache: "miss", ocrMs: 5 }));
    const { ocr } = summarize(events, { since: base - 1, until: Date.now() });
    expect(ocr.recent).toHaveLength(20);
    expect(ocr.recent[0].ts).toBe(events[449].ts);
    expect(ocr.recent[19].ts).toBe(events[430].ts);
    expect(ocr.totalImages).toBe(450);
  });
});
