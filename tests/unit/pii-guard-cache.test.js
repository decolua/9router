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
  });
});
