import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let TMP;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsapi-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeReq(query = "") {
  const url = `http://localhost:20128/api/token-saver/stats${query}`;
  return {
    url,
    headers: new Headers({ host: "localhost:20128" }),
    nextUrl: { searchParams: new URL(url).searchParams },
  };
}

describe("GET /api/token-saver/stats", () => {
  it("returns 200 with stable schema and truthful unit labels", async () => {
    process.env.DATA_DIR = TMP;
    vi.resetModules();
    const eventsMod = await import("@/lib/tokenSaver/events.js");
    eventsMod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: 25 });
    const { GET } = await import("@/app/api/token-saver/stats/route.js");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.windows).toBeDefined();
    expect(j.timeline).toBeDefined();
    expect(j.recent).toBeDefined();
    expect(j.sources.rtk.unit).toMatch(/char/i);
    expect(j.sources.headroom.unit).toMatch(/token/i);
    expect(j.sources.pxpipe.unit).toMatch(/estimated/i);
    expect(j.windows.all.charsReduced).toBe(25);
    const raw = JSON.stringify(j);
    // no top-level synthetic aggregate totalSaved, no USD synthesis.
    // pxpipe sub-object strips savedPct (no within-window percentage claim).
    expect(raw).not.toMatch(/"totalSaved"|"totalChars"|"usd"|"cost:/i);
    expect(JSON.stringify(j.pxpipe)).not.toMatch(/savedPct/i);
    // no infra leakage
    expect(raw).not.toMatch(TMP.replace(/\\/g, "\\\\"));
    expect(raw).not.toMatch(/pid|hostname|"host"|endpoint.*url/i);
  });

  it("source failure degrades to unavailable without failing endpoint (fetch stubbed to throw)", async () => {
    process.env.DATA_DIR = TMP;
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const { GET } = await import("@/app/api/token-saver/stats/route.js");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.windows).toBeDefined();
    expect(j.sources.headroom.state).toBe("unavailable");
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);
  });

  it("performs no outbound network at all — getPxpipeStats reused directly for pxpipe source", async () => {
    process.env.DATA_DIR = TMP;
    vi.resetModules();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const pxpipeEvents = await import("@/lib/pxpipe/events.js");
    const spy = vi.spyOn(pxpipeEvents, "getPxpipeStats");
    const { GET } = await import("@/app/api/token-saver/stats/route.js");
    await GET(makeReq());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it("clamps query params (recentLimit/timelineDays/sinceMs)", async () => {
    process.env.DATA_DIR = TMP;
    vi.resetModules();
    const eventsMod = await import("@/lib/tokenSaver/events.js");
    const spy = vi.spyOn(eventsMod, "getTokenSaverStats");
    const { GET } = await import("@/app/api/token-saver/stats/route.js");
    await GET(makeReq("?timelineDays=99999&recentLimit=100000&sinceMs=abc"));
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[0][0];
    expect(arg.timelineDays).toBeLessThanOrEqual(90);
    expect(arg.recentLimit).toBeLessThanOrEqual(500);
    expect(arg.sinceMs).toBeUndefined();
  });

  it("store failure still yields stable empty schema with HTTP 200", async () => {
    process.env.DATA_DIR = path.join(TMP, "never-created-ok");
    vi.resetModules();
    const eventsMod = await import("@/lib/tokenSaver/events.js");
    eventsMod.__setTokenSaverEventsDirForTest(path.join(TMP, "blocked"));
    fs.writeFileSync(path.join(TMP, "blocked"), "file blocks mkdir");
    const { GET } = await import("@/app/api/token-saver/stats/route.js");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.windows).toBeDefined();
    // read fails open: no rows → zero-filled windows, empty recent
    expect(j.recent).toEqual([]);
    expect(j.windows.all.requests).toBe(0);
    expect(j.timeline.every((d) => d.requests === 0)).toBe(true);
  });
});
