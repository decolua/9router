import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// mkdtempSync per test — isolated DATA_DIR-equivalent via internal seam.
let TMP;

async function loadModule() {
  return await import("@/lib/tokenSaver/events.js");
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsevents-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("tokenSaver event store", () => {
  it("persists RTK row as characters with allowlisted fields only", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({
      saver: "rtk",
      applied: true,
      appliedCount: 2,
      charsBefore: 100,
      charsAfter: 70,
      charsSaved: 30,
    });
    const rows = mod.readTokenSaverEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].saver).toBe("rtk");
    expect(rows[0].charsSaved).toBe(30);
    expect(rows[0].charsBefore).toBe(100);
    expect(rows[0].charsAfter).toBe(70);
    expect(rows[0].appliedCount).toBe(2);
  });

  it("strips unknown fields (privacy: no prompts/tools/format/reasons)", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({
      saver: "rtk",
      applied: true,
      charsBefore: 10,
      charsAfter: 5,
      charsSaved: 5,
      // hostile extras that must never land on disk
      prompt: "secret prompt",
      messages: [{ role: "user", content: "leak" }],
      toolName: "Bash",
      toolArgs: { cmd: "rm -rf" },
      filter: "git_diff",
      shape: "claude-string",
      format: "claude->openai",
      provider: "anthropic",
      model: "claude-x",
      connectionId: "conn-123",
      sessionId: "sess-9",
      url: "http://x/y",
      apiKey: "sk-secret",
      headers: { authorization: "Bearer x" },
      detail: "free-form",
      reason: "whatever",
    });
    const raw = fs.readFileSync(path.join(TMP, "events.jsonl"), "utf8");
    expect(raw).not.toMatch(/prompt|messages|toolName|toolArgs|filter|shape|format|provider|model|connectionId|sessionId|apiKey|headers|detail|reason/i);
    const rows = mod.readTokenSaverEvents();
    expect(Object.keys(rows[0]).sort()).toEqual([
      "applied", "charsAfter", "charsBefore", "charsSaved", "saver", "ts",
    ]);
    expect(Object.keys(rows[0])).not.toContain("appliedCount");
  });

  it("rejects unknown savers", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ saver: "headroomX", applied: true });
    mod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: 1 });
    const rows = mod.readTokenSaverEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].saver).toBe("rtk");
  });

  it("accepts only saver rtk, headroom, pxpipe", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    for (const saver of ["rtk", "headroom", "pxpipe"]) {
      mod.appendTokenSaverEvent({ saver, applied: true });
    }
    const rows = mod.readTokenSaverEvents();
    expect(rows.map((r) => r.saver).sort()).toEqual(["headroom", "pxpipe", "rtk"]);
  });

  it("clamps non-finite and negative numerics", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({
      saver: "rtk",
      applied: true,
      charsBefore: -50,
      charsAfter: NaN,
      charsSaved: Infinity,
      appliedCount: 1.7,
    });
    const rows = mod.readTokenSaverEvents();
    expect(rows[0].charsBefore).toBe(0);
    expect(rows[0].charsAfter).toBeUndefined();
    expect(rows[0].charsSaved).toBeUndefined();
    expect(rows[0].appliedCount).toBe(2); // 1.7 clamped rounded
    mod.appendTokenSaverEvent({ saver: "rtk", applied: true, ts: "not-a-number" });
    const rows2 = mod.readTokenSaverEvents();
    expect(Number.isFinite(rows2[rows2.length - 1].ts)).toBe(true);
  });

  it("rotates at 5MB keeping exactly one .1 backup (seam-driven)", async () => {
    const mod = await loadModule();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsrotate-"));
    mod.__setTokenSaverEventsDirForTest(dir, { maxFileBytes: 512 });
    try {
      const row = JSON.stringify({
        ts: Date.now(), saver: "rtk", applied: true, appliedCount: 1,
        charsBefore: 100, charsAfter: 70, charsSaved: 30,
      });
      // rotation fires when the file EXCEEDS the bound before an append; after the
      // rename, the live file restarts small and holds only post-rotation rows.
      for (let i = 0; i < 6; i++) mod.appendTokenSaverEvent({ saver: "rtk", applied: true, appliedCount: 1, charsBefore: 100, charsAfter: 70, charsSaved: 30 });
      expect(fs.existsSync(path.join(dir, "events.jsonl.1"))).toBe(true);
      expect(fs.statSync(path.join(dir, "events.jsonl")).size).toBeLessThan(512);
      const rows = mod.readTokenSaverEvents();
      expect(rows.length).toBeGreaterThanOrEqual(6);
      for (let i = 1; i < rows.length; i++) expect(rows[i].ts).toBeGreaterThanOrEqual(rows[i - 1].ts);
      expect(row).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("second rotation overwrites old backup (bounded to two files)", async () => {
    const mod = await loadModule();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsrotate2-"));
    mod.__setTokenSaverEventsDirForTest(dir, { maxFileBytes: 256 });
    try {
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 4; i++) mod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: 1 });
      }
      const files = fs.readdirSync(dir).filter((f) => f.startsWith("events.jsonl")).sort();
      expect(files.length).toBeLessThanOrEqual(2);
      const rows = mod.readTokenSaverEvents();
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips corrupt and truncated lines on read", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: 1 });
    fs.appendFileSync(path.join(TMP, "events.jsonl"), '{"ts":1,"saver":"rtk"\n');   // truncated
    fs.appendFileSync(path.join(TMP, "events.jsonl"), 'garbage\n');                  // corrupt
    mod.appendTokenSaverEvent({ saver: "headroom", applied: true, tokensSaved: 2 });
    const rows = mod.readTokenSaverEvents();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.saver)).toEqual(["rtk", "headroom"]);
  });

  it("never mutates the input event object", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    const evt = { saver: "rtk", applied: true, charsBefore: 10, charsAfter: 5, charsSaved: 5, leak: "x" };
    const snap = JSON.stringify(evt);
    mod.appendTokenSaverEvent(evt);
    expect(JSON.stringify(evt)).toBe(snap);
    expect(evt.leak).toBe("x");
  });

  it("concurrent appends from one process never lose rows or throw", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(TMP);
    const N = 200;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() => {
          mod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: i });
        })
      )
    );
    const rows = mod.readTokenSaverEvents();
    expect(rows).toHaveLength(N);
  });

  it("append and read fail open on filesystem errors", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(path.join(TMP, "blocked", "deep"));
    // ensureDir will fail: "blocked" created as a FILE so mkdir recursive fails
    fs.writeFileSync(path.join(TMP, "blocked"), "x");
    expect(() => mod.appendTokenSaverEvent({ saver: "rtk", applied: true, charsSaved: 1 })).not.toThrow();
    mod.__setTokenSaverEventsDirForTest(TMP);
    fs.writeFileSync(path.join(TMP, "events.jsonl"), "");
    fs.chmodSync?.(path.join(TMP, "events.jsonl"), 0o000);
    let out = [];
    try { out = mod.readTokenSaverEvents(); } catch (e) { out = e; }
    expect(Array.isArray(out)).toBe(true);
    fs.chmodSync?.(path.join(TMP, "events.jsonl"), 0o644);
  });

  it("read on missing dir returns empty array", async () => {
    const mod = await loadModule();
    mod.__setTokenSaverEventsDirForTest(path.join(TMP, "does-not-exist"));
    expect(mod.readTokenSaverEvents()).toEqual([]);
  });
});
