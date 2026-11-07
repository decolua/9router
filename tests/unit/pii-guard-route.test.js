import { describe, it, expect, vi, beforeEach } from "vitest";

const { settings, updateSettings } = vi.hoisted(() => {
  const settings = { piiGuard: { mode: "observe", rules: {}, ignore: [] } };
  return { settings, updateSettings: vi.fn(async update => { settings.piiGuard = update.piiGuard; }) };
});
vi.mock("@/lib/localDb", () => ({ getSettings: async () => settings, updateSettings }));
vi.mock("@/lib/piiGuard/observe.js", () => ({ ready: async () => true, rules: () => [], groups: () => [], testText: async () => null, testImage: async () => null, eventsFile: () => "/tmp/ev.jsonl", health: () => ({}) }));

import { GET, POST } from "../../src/app/api/pii-guard/route.js";
import { writeFile, rm, appendFile } from "node:fs/promises";

beforeEach(async () => {
  settings.piiGuard = { mode: "observe", rules: {}, ignore: [] };
  await rm("/tmp/ev.jsonl", { force: true });
  await writeFile("/tmp/ev.jsonl", JSON.stringify({ ts: new Date().toISOString(), hits: [] }) + "\n");
});

describe("route OCR config", () => {
  it("validates OCR settings and preserves saved quality on other settings", async () => {
    const invalid = await POST(new Request("http://localhost/api/pii-guard", { method: "POST", body: JSON.stringify({ ocr: { mode: "block" } }) }));
    expect(invalid.status).toBe(400);
    const saved = await POST(new Request("http://localhost/api/pii-guard", { method: "POST", body: JSON.stringify({ mode: "redact", ocr: { quality: "basic" } }) }));
    expect(saved.status).toBe(200);
    expect(settings.piiGuard).toMatchObject({ mode: "redact", ocr: { mode: "observe", quality: "basic" } });
  });
});

describe("route range", () => {
  it("rejects bad range with 400", async () => {
    const req = new Request("http://localhost/api/pii-guard?from=abc&to=1");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
  it("events pagination keeps events that share a timestamp across pages", async () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    const lines = [1, 2, 3].map(i => ({ ts, hits: [{ hash: `h${i}`, rule: "r", action: "observe" }] }));
    await writeFile("/tmp/ev.jsonl", lines.map(l => JSON.stringify(l)).join("\n") + "\n");
    const first = await (await GET(new Request("http://localhost/api/pii-guard?events=1&limit=2"))).json();
    expect(first.events).toHaveLength(2);
    const { before, skip } = first.next;
    const second = await (await GET(new Request(`http://localhost/api/pii-guard?events=1&limit=2&before=${before}&skip=${skip}`))).json();
    expect(second.events).toHaveLength(1);
    expect(new Set([...first.events, ...second.events].map(e => e.hits[0].hash)).size).toBe(3);
  });
  it("events filters apply before paging and the cursor skips filtered-out events", async () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    const hit = (i, action, source = "user/text") => ({ hash: `h${i}`, rule: "r", action, source });
    const lines = [
      { ts, model: "m1", ua: "codex/1", hits: [hit(1, "redact")] },
      { ts, model: "m2", ua: "codex/1", hits: [hit(2, "redact")] },
      { ts, model: "m1", ua: "claude-cli/1", hits: [hit(3, "observe"), hit(4, "redact", "user/ocr")] },
      { ts, model: "m1", ua: "codex/1", hits: [hit(5, "redact")] },
      { ts, model: "m1", ua: "codex/1", hits: [hit(6, "redact")] },
    ];
    await writeFile("/tmp/ev.jsonl", lines.map(l => JSON.stringify(l)).join("\n") + "\n");
    const get = async (q) => (await GET(new Request(`http://localhost/api/pii-guard?events=1&${q}`))).json();
    const seen = [];
    let q = "limit=1&model=m1&action=redact&source=text";
    for (let i = 0; i < 5; i++) {
      const page = await get(q);
      seen.push(...page.events.flatMap(e => e.hits.map(h => h.hash)));
      if (!page.next) break;
      q = `limit=1&model=m1&action=redact&source=text&before=${page.next.before}&skip=${page.next.skip}`;
    }
    // Newest first: h6, h5, h1. h2 is model m2; h3 is observe; h4 is OCR.
    expect(seen).toEqual(["h6", "h5", "h1"]);
    const claude = await get("limit=10&client=Claude%20Code&source=ocr");
    expect(claude.events.flatMap(e => e.hits.map(h => h.hash))).toEqual(["h4"]);
  });
  it("summary memo reuses an idle summary and refreshes when the log grows", async () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    await writeFile("/tmp/ev.jsonl", JSON.stringify({ ts, hits: [{ hash: "aaaaaaaaaaaa", rule: "r", action: "observe" }] }) + "\n");
    const first = await (await GET(new Request("http://localhost/api/pii-guard"))).json();
    const again = await (await GET(new Request("http://localhost/api/pii-guard"))).json();
    expect(again.summary.unique24h).toBe(first.summary.unique24h);
    await appendFile("/tmp/ev.jsonl", JSON.stringify({ ts, hits: [{ hash: "bbbbbbbbbbbb", rule: "r", action: "observe" }] }) + "\n");
    const grown = await (await GET(new Request("http://localhost/api/pii-guard"))).json();
    expect(grown.summary.unique24h).toBe(first.summary.unique24h + 1);
  });
  it("settings POST returns the saved config, not a summary", async () => {
    const body = await (await POST(new Request("http://localhost/api/pii-guard", { method: "POST", body: JSON.stringify({ mode: "redact" }) }))).json();
    expect(body).toMatchObject({ ok: true, config: { mode: "redact" } });
    expect(body.summary).toBeUndefined();
  });
  it("events pagination returns a cursor and skips stats", async () => {
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
    expect(body.next).not.toBeNull();
  });
});
