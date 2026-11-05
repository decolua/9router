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
