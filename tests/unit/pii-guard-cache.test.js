import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ piiGuard: { mode: "observe", rules: {}, ignore: [] } }), updateSettings: async () => {} }));
vi.mock("@/lib/piiGuard/observe.js", () => ({ ready: async () => true, rules: () => [], groups: () => [], testText: async () => null, eventsFile: () => "/tmp/ev3.jsonl", health: () => ({}) }));

import { loadEvents } from "../../src/app/api/pii-guard/route.js";
import { writeFile, appendFile, rm } from "node:fs/promises";

describe("cache append", () => {
  beforeEach(async () => { try { await rm("/tmp/ev3.jsonl"); } catch {} });
  it("two calls where second parses only appended lines", async () => {
    const line = (ts) => JSON.stringify({ ts: new Date(ts).toISOString(), hits: [] });
    const t0 = Date.now();
    await writeFile("/tmp/ev3.jsonl", line(t0) + "\n");
    const r1 = await loadEvents(t0 - 100000);
    expect(r1.events.length).toBe(1);
    await appendFile("/tmp/ev3.jsonl", line(t0 + 1000) + "\n");
    const r2 = await loadEvents(t0 - 100000);
    expect(r2.events.length).toBe(2);
    expect(Date.parse(r2.events[0].ts)).toBe(t0 + 1000); // newest first
  });
  it("waits for a half-written last line and reads backward for an older range", async () => {
    const line = (ts) => JSON.stringify({ ts: new Date(ts).toISOString(), hits: [] });
    const t0 = Date.now() - 10 * 86400000;
    const old = Array.from({ length: 5000 }, (_, i) => line(t0 + i * 1000)).join("\n") + "\n";
    await writeFile("/tmp/ev3.jsonl", old + line(Date.now()).slice(0, 10));
    const recent = await loadEvents(Date.now() - 3600000);
    expect(recent.events.length).toBeGreaterThan(0);
    const all = await loadEvents(t0 - 1);
    expect(all.events.length).toBe(5000);
    expect(all.truncated).toBe(false);
  });
});
