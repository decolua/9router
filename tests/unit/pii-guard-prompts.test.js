import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const library = await import("/home/chetan/Projects/pii-guard/dist/index.js");
const P = await import("../../src/lib/piiGuard/prompts.js");
const detector = library.createDetector({ known: [{ name: "pin", value: "zx81" }], salt: "abcdef0123456789" });
const pan = ["ABCPE", "1234", "F"].join(""), mail = ["priya.sharma", "corpmail.in"].join("@");
let dir;
const tick = () => new Promise((r) => setImmediate(r));
async function run(body, sessionId = "s1", requestId = "r1") {
  P.capture({ nodes: P.collect(body), requestId, sessionId, model: "m", client: "Claude Code" }, library, detector);
  await tick(); P.flush();
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pii-prompts-")); process.env.PII_GUARD_PROMPTS = join(dir, "c", "prompts.db"); P._reset(); });
afterEach(async () => { P._reset(); delete process.env.PII_GUARD_PROMPTS; await rm(dir, { recursive: true, force: true }); });

describe("prompt store", () => {
  it("stores masked text, searchable by any word, with no raw value on disk", async () => {
    await run({ system: "You are helpful", messages: [{ role: "user", content: `Repeat this to me: PAN ${pan}, mail ${mail}, pin zx81. Where should I store personal information?` }] });
    const { rows } = P.search({ q: "repeat this" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId: "r1", sessionId: "s1", role: "user", client: "Claude Code" });
    const m = P.message(rows[0].id);
    expect(m.text).toContain("•••••@corpmail.in");
    expect(P.search({ q: "personal informat" }).rows).toHaveLength(1);
    expect(P.search({ q: "helpful" }).rows[0].role).toBe("system");
    const raw = (await readFile(process.env.PII_GUARD_PROMPTS)).toString("latin1") + await readFile(`${process.env.PII_GUARD_PROMPTS}-wal`).then((b) => b.toString("latin1")).catch(() => "");
    for (const v of [pan, mail, "zx81"]) expect(raw).not.toContain(v);
    expect((await stat(process.env.PII_GUARD_PROMPTS)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "c"))).mode & 0o777).toBe(0o700);
  });
  it("stores only new messages per session, and links findings by hash", async () => {
    const turn1 = [{ role: "user", content: "first question" }];
    await run({ system: "sys", messages: turn1 }, "s1", "r1");
    await run({ system: "sys", messages: [...turn1, { role: "assistant", content: "answer" }, { role: "user", content: `second ${pan}` }] }, "s1", "r2");
    const r2 = P.search({ requestId: "r2" }).rows;
    expect(r2.map((r) => P.message(r.id).text).sort()).toEqual(["answer", "second AB•••••F"]);
    expect(P.search({ sessionId: "s1" }).rows).toHaveLength(4);
    const h = detector.scan(pan)[0].hash;
    expect(P.search({ hash: h }).rows.map((r) => r.requestId)).toEqual(["r2"]);
    await run({ system: "sys", messages: [...turn1, { role: "user", content: `second ${pan}` }, { role: "user", content: "third" }] }, "s1", "r3");
    expect(P.search({ requestId: "r3" }).rows.map((r) => P.message(r.id).text)).toEqual(["third"]);
  });
  it("without a session keeps the latest message only", async () => {
    await run({ messages: [{ role: "user", content: "old turn" }, { role: "user", content: "new turn" }] }, null);
    expect(P.search({}).rows.map((r) => P.message(r.id).text)).toEqual(["new turn"]);
  });
  it("collects tool calls and results, skips thinking", () => {
    const nodes = P.collect({ messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "secret plan", signature: "s" }, { type: "tool_use", name: "Bash", input: { cmd: "ls" } }] }, { role: "user", content: [{ type: "tool_result", content: "files" }] }] });
    expect(nodes.map((n) => [n.kind, n.text])).toEqual([["tool_use", 'Bash {"cmd":"ls"}'], ["tool_result", "files"]]);
  });
  it("caps tool output and pages results", async () => {
    await run({ messages: [{ role: "tool", content: "x ".repeat(P.TOOL_CAP) }] });
    expect(P.message(P.search({}).rows[0].id).cut).toBe(1);
    for (let i = 0; i < 3; i++) await run({ messages: [{ role: "user", content: `page word ${i}` }] }, "s2", `p${i}`);
    const a = P.search({ q: "page", limit: 2 });
    expect(a.rows).toHaveLength(2);
    expect(P.search({ q: "page", limit: 2, before: a.next }).rows).toHaveLength(1);
  });
  it("search input cannot inject FTS syntax", () => {
    expect(() => P.search({ q: 'a" OR NEAR(b' })).not.toThrow();
    expect(P.search({ q: "***" }).rows).toEqual([]);
  });
  it("observeRequest stores the original prompt masked, with session, while the body is still redacted", async () => {
    process.env.PII_GUARD_MODULE = "/home/chetan/Projects/pii-guard/dist/index.js";
    process.env.PII_GUARD_KNOWN = join(dir, "known.json");
    await writeFile(process.env.PII_GUARD_KNOWN, JSON.stringify({ version: 1, salt: "abcdef0123456789", items: [] }));
    try {
      const { observeRequest } = await import("../../src/lib/piiGuard/observe.js");
      const body = { model: "m", messages: [{ role: "user", content: `Repeat this to me: ${mail}` }] };
      await observeRequest(body, { endpoint: "/v1/messages", userAgent: "claude-cli/2", sessionId: "claude:abc" }, { mode: "redact", rules: {} });
      expect(body.messages[0].content).toMatch(/^Repeat this to me: \{\{pii:email#[0-9a-f]{6}\}\}$/);
      await tick(); P.flush();
      const [row] = P.search({ q: "repeat" }).rows;
      expect(row).toMatchObject({ sessionId: expect.stringMatching(/^[0-9a-f]{24}$/), client: "Claude Code" });
      expect(P.message(row.id).text).toBe("Repeat this to me: •••••@corpmail.in");
    } finally { delete process.env.PII_GUARD_MODULE; delete process.env.PII_GUARD_KNOWN; }
  });
  it("never stores a value the request scan found only through sibling context, or a client role", async () => {
    process.env.PII_GUARD_MODULE = "/home/chetan/Projects/pii-guard/dist/index.js";
    process.env.PII_GUARD_KNOWN = join(dir, "known.json");
    await writeFile(process.env.PII_GUARD_KNOWN, JSON.stringify({ version: 1, salt: "abcdef0123456789", items: [] }));
    try {
      const { observeRequest } = await import("../../src/lib/piiGuard/observe.js");
      const num = ["98765", "43210"].join("");
      expect(detector.scan(num)).toEqual([]); // bare string: no keyword, no finding
      const body = { model: "m", messages: [{ role: `user ${pan}`, label: "mobile", content: num }, { role: "user", content: "latest turn" }] };
      await observeRequest(body, { endpoint: "/v1/messages", userAgent: "x/1", sessionId: "raw-session" }, { mode: "observe", rules: {} });
      await tick(); P.flush();
      const rows = P.search({}).rows;
      const all = rows.map((r) => JSON.stringify(P.message(r.id))).join(" ");
      for (const v of [num, pan, "raw-session"]) expect(all).not.toContain(v);
      expect(rows.every((r) => /^[0-9a-f]{24}$/.test(r.sessionId))).toBe(true);
    } finally { delete process.env.PII_GUARD_MODULE; delete process.env.PII_GUARD_KNOWN; }
  });
  it("drops context-only values in every body shape, including repeats inside tool input", async () => {
    process.env.PII_GUARD_MODULE = "/home/chetan/Projects/pii-guard/dist/index.js";
    process.env.PII_GUARD_KNOWN = join(dir, "known.json");
    await writeFile(process.env.PII_GUARD_KNOWN, JSON.stringify({ version: 1, salt: "abcdef0123456789", items: [] }));
    try {
      const { observeRequest } = await import("../../src/lib/piiGuard/observe.js");
      const num = ["98765", "43210"].join(""), num2 = ["91234", "56780"].join("");
      const bodies = [
        { model: "m", label: "mobile", input: num },
        { model: "m", label: "mobile", instructions: num, input: [{ role: "user", content: "hi" }] },
        { model: "m", label: "mobile", system: num, messages: [{ role: "user", content: "hi" }] },
        { model: "m", messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: { first: `mobile ${num}`, padding: "x".repeat(100), value: num } }] }] },
        { model: "m", messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: { first: `mobile ${num}`, padding: "x".repeat(100), value: num2 } }] }] },
      ];
      for (const [i, body] of bodies.entries()) await observeRequest(body, { endpoint: "/v1/messages", userAgent: "x/1", sessionId: `s${i}` }, { mode: "observe", rules: {} });
      await tick(); P.flush();
      const all = P.search({}).rows.map((r) => P.message(r.id).text).join(" ");
      for (const v of [num, num2]) expect(all).not.toContain(v);
      expect(P.stats.unsafe).toBeGreaterThan(0); // unsafe nodes are dropped and counted, never stored
    } finally { delete process.env.PII_GUARD_MODULE; delete process.env.PII_GUARD_KNOWN; }
  });
  it("deletes rows older than 14 days", async () => {
    await run({ messages: [{ role: "user", content: "old" }] });
    expect(P.sweep(Date.now() + 15 * 864e5)).toBe(1);
    expect(P.search({ q: "old" }).rows).toEqual([]);
  });
});

describe("coverage guard", () => {
  it("drops a node when the request scan saw more hits than the node rescan masks", async () => {
    const lib = { ...library, maskText: (t) => t }; // a masker that misses everything
    const plain = library.createDetector({ salt: "abcdef0123456789" });
    const quiet = { ...plain, scan: () => [] }; // rescan sees nothing, like a context-only value
    P.capture({ nodes: [{ text: "value 9876543210", role: "user", kind: "text", path: "messages[0].content" }], bodyFindings: [{ path: "messages[0].content.x", start: 0, end: 1, hash: "aaaaaaaaaaaa", rule: "in_phone", kind: "pii" }], requestId: "g", sessionId: "s", model: "m", client: "c" }, lib, quiet);
    await new Promise((r) => setImmediate(r)); P.flush();
    expect(P.stats.unsafe).toBe(1);
    expect(P.search({}).rows).toEqual([]);
  });
});
