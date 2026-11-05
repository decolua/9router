import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ piiGuard: { mode: "observe", rules: {}, ignore: [] } }), updateSettings: async () => {} }));
vi.mock("@/lib/piiGuard/observe.js", () => ({ ready: async () => true, rules: () => [], groups: () => [], testText: async () => null, eventsFile: () => "/tmp/ev.jsonl", health: () => ({}) }));

import { GET } from "../../src/app/api/pii-guard/route.js";
import { writeFile, rm } from "node:fs/promises";

beforeEach(async () => {
  await writeFile("/tmp/ev.jsonl", JSON.stringify({ ts: new Date().toISOString(), hits: [] }) + "\n");
});

describe("route range", () => {
  it("rejects bad range with 400", async () => {
    const req = new Request("http://localhost/api/pii-guard?from=abc&to=1");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
  it("events pagination returns nextBefore and skips stats", async () => {
    const now = Date.now();
    const lines = [
      { ts: new Date(now - 1000).toISOString(), type: "stats", counts: { a: 1 } },
      { ts: new Date(now - 2000).toISOString(), hits: [{ hash: "h", rule: "r", action: "observe" }] },
      { ts: new Date(now - 3000).toISOString(), hits: [{ hash: "h2", rule: "r", action: "observe" }] },
    ];
    await writeFile("/tmp/ev.jsonl", lines.map(l=>JSON.stringify(l)).join("\n")+"\n");
    const req = new Request(`http://localhost/api/pii-guard?events=1&limit=1`);
    const res = await GET(req);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).not.toBe("stats");
    expect(body.nextBefore).not.toBeNull();
  });
});
