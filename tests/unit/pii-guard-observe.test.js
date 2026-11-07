import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const modulePath = "/home/chetan/Projects/pii-guard/dist/index.js";
const value = "synthetic-own-value-739201";
let dir, events, known, observeRequest, health;
const body = text => ({ model: "test", messages: [{ role: "user", content: [{ type: "tool_result", content: text }] }] });
const meta = { endpoint: "/v1/messages", userAgent: "test/1 example", model: "test" };
async function lines(n) {
  for (let i = 0; i < 100; i++) {
    try { const text = await readFile(events, "utf8"); if (text.trim().split("\n").length >= n) return text; } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Event not written");
}
async function writeKnown(name, val) {
  await writeFile(known, JSON.stringify({ version: 1, salt: "abcdef0123456789", items: [{ name, value: val }] }));
}
beforeEach(async () => {
  process.env.PII_GUARD_PROMPTS = "off";
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), "pii-observe-"));
  events = join(dir, "events", "events.jsonl"); known = join(dir, "known.json");
  process.env.PII_GUARD_MODULE = modulePath; process.env.PII_GUARD_KNOWN = known; process.env.PII_GUARD_EVENTS = events;
  await writeKnown("own-test", value);
  ({ observeRequest, health } = await import("../../src/lib/piiGuard/observe.js"));
});
afterEach(async () => {
  delete process.env.PII_GUARD_MODULE; delete process.env.PII_GUARD_KNOWN; delete process.env.PII_GUARD_EVENTS;
  vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true });
});
describe("PII observation", () => {
  it("does nothing when disabled", async () => {
    delete process.env.PII_GUARD_MODULE;
    await observeRequest(body(value), meta);
    await expect(stat(events)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("logs names to the console, never values", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await observeRequest(body(value), meta);
    await observeRequest(body(value), meta);
    expect(warn).toHaveBeenCalledWith("[pii-guard] test /v1/messages: own-test=1 (new: own-test)");
    expect(info).toHaveBeenCalledWith("[pii-guard] test /v1/messages: own-test=1");
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain(value);
  });
  it("writes only metadata and deduplicates findings", async () => {
    await observeRequest(body(value), meta);
    let text = await lines(1);
    expect(text).not.toContain(value);
    const first = JSON.parse(text.trim());
    expect(first.counts).toEqual({ "own-test": 1 });
    expect(first.new[0]).toMatchObject({ name: "own-test", source: "user/tool_result", rule: "known" });
    expect((await stat(events)).mode & 0o777).toBe(0o600);
    await observeRequest(body(value), meta);
    text = await lines(2);
    expect(text).not.toContain(value);
    expect(JSON.parse(text.trim().split("\n")[1]).new).toEqual([]);
  });
  it("stores a masked preview and context, never the raw value", async () => {
    const key = "sk-ant-" + "Q1w2E3r4T5y6U7i8O9p0AsDf";
    await observeRequest(body(`my key is ${key} and ${value} ok`), meta);
    const text = await lines(1);
    expect(text).not.toContain(key); expect(text).not.toContain(value); expect(text).not.toContain("739201");
    const hits = JSON.parse(text.trim()).hits;
    const k = hits.find(h => h.rule === "anthropic_key");
    expect(k.preview).toBe("sk-ant-•••••sDf");
    expect(k.context).toContain("my key is sk-ant-•••••sDf and •••••");
    expect(hits.find(h => h.rule === "known").preview).toBe("•••••");
  });
  it("never throws when scanning fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { get messages() { throw new Error("synthetic"); } };
    await expect(observeRequest(bad, meta)).resolves.toBeUndefined();
  });
  it("reloads changed known lists after the check interval", async () => {
    await observeRequest(body(value), meta); await lines(1);
    const next = "synthetic-new-value-729824";
    await writeKnown("next-test", next);
    const future = new Date(Date.now() + 5000); await utimes(known, future, future);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await observeRequest(body(next), meta);
    expect(JSON.parse((await lines(2)).trim().split("\n")[1]).counts).toEqual({ "next-test": 1 });
  });
});
describe("PII guard modes", () => {
  const pii = "call me on mobile 9876543210";
  it("skips scanning when off", async () => {
    await observeRequest(body(pii), meta, { mode: "off" });
    await expect(stat(events)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("redacts all scanned strings, including system and assistant history", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = { system: pii, messages: [{ role: "user", content: pii }, { role: "assistant", content: pii }] };
    expect(await observeRequest(req, meta, { mode: "redact" })).toBeUndefined();
    expect(req.messages[0].content).toMatch(/^call me on mobile \{\{pii:in_phone#[0-9a-f]{6}\}\}$/);
    expect(req.messages[1].content).toMatch(/^call me on mobile \{\{pii:in_phone#[0-9a-f]{6}\}\}$/);
    expect(req.system).toMatch(/^call me on mobile \{\{pii:in_phone#[0-9a-f]{6}\}\}$/);
    expect(JSON.parse(await lines(1)).redacted).toEqual({ in_phone: 3 });
  });
  it("redacts tool results inside user blocks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = body(pii);
    await observeRequest(req, meta, { mode: "redact" });
    expect(req.messages[0].content[0].content).not.toContain("9876543210");
  });
  it("blocks by rule override and logs an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await observeRequest(body(pii), meta, { mode: "observe", rules: { in_phone: "block" } })).toEqual({ blocked: ["in_phone"] });
    expect(error.mock.calls[0][0]).toContain("BLOCKED: in_phone");
    expect(error.mock.calls[0][0]).not.toContain("9876543210");
  });
  it("lets a rule override turn one rule off", async () => {
    const req = body(pii);
    expect(await observeRequest(req, meta, { mode: "block", rules: { in_phone: "off" } })).toBeUndefined();
    expect(req.messages[0].content[0].content).toBe(pii);
  });
});
describe("PII guard block scope", () => {
  it("blocks a match in the system prompt too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const req = { system: "mobile 9876543210", messages: [{ role: "user", content: "hi" }] };
    expect(await observeRequest(req, meta, { mode: "block" })).toEqual({ blocked: ["in_phone"] });
  });
});
describe("PII guard full-body coverage", () => {
  it("redacts all 15 scanner request shapes", async () => {
    const key = "synthetic-extra-value-829104";
    await writeKnown("shape-key", key);
    const { utimes } = await import("node:fs/promises");
    const future = new Date(Date.now() + 5000); await utimes(known, future, future);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    const shapes = [
      { system: `key ${key}`, messages: [] }, { system: [{ type: "text", text: key }], messages: [] },
      { messages: [{ role: "assistant", content: key }] },
      { messages: [{ role: "assistant", content: [{ type: "tool_use", input: { command: key } }] }] },
      { messages: [{ role: "user", content: [{ type: "tool_result", content: key }] }] },
      { tools: [{ description: key }], messages: [] }, { messages: [{ role: "system", content: key }] },
      { messages: [{ role: "assistant", tool_calls: [{ function: { arguments: key } }] }] },
      { messages: [{ role: "tool", content: key }] }, { instructions: key, input: "hi" },
      { input: `hi ${key}` }, { input: [{ type: "function_call_output", output: key }] },
      { systemInstruction: { parts: [{ text: key }] }, contents: [] },
      { contents: [{ role: "user", parts: [{ text: key }] }] },
      { contents: [{ role: "user", parts: [{ functionResponse: { response: { out: key } } }] }] },
    ];
    for (const req of shapes) {
      await observeRequest(req, meta, { mode: "redact" });
      expect(JSON.stringify(req)).not.toContain(key);
    }
  });
  it("blocks unseen values once, then redacts same history", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = body(value);
    expect(await observeRequest(first, meta, { mode: "block" })).toEqual({ blocked: ["own-test"] });
    expect(await lines(1)).toBeTruthy();
    const second = body(value);
    expect(await observeRequest(second, meta, { mode: "block" })).toBeUndefined();
    expect(JSON.stringify(second)).not.toContain(value);
  });
  it("reports health and readonly findings", async () => {
    const key = "synthetic-media-value-830125";
    await writeKnown("media-key", key);
    const future = new Date(Date.now() + 5000); await utimes(known, future, future);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    const req = { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "AAAA", note: key } }] }] };
    await observeRequest(req, meta, { mode: "redact" });
    const event = JSON.parse((await lines(1)).trim());
    expect(event.leaked).toEqual({ "media-key": 1 });
    expect(health()).toMatchObject({ module: true, loaded: true, errors: 0, requests: 1, withFindings: 1, seen: 1 });
    expect(health().unscanned).toMatchObject({ images: 1 });
  });
  it("ignores configured hashes and persists seen hashes across reload", async () => {
    const { testText } = await import("../../src/lib/piiGuard/observe.js");
    const preview = await testText(value, { mode: "redact" });
    const hash = preview.findings[0].hash;
    const ignored = body(value);
    await observeRequest(ignored, meta, { mode: "block", ignore: [hash] });
    expect(JSON.stringify(ignored)).toContain(value);
    const event = JSON.parse((await lines(2)).trim().split("\n").find(line => JSON.parse(line).type !== "test"));
    expect(event.ignored).toBe(1);
    expect(event.counts).toEqual({});
    vi.resetModules();
    ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));
    const first = body(value);
    expect(await observeRequest(first, meta, { mode: "block" })).toEqual({ blocked: ["own-test"] });
    await lines(2);
    await new Promise(resolve => setTimeout(resolve, 5100));
    vi.resetModules();
    ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));
    const retry = body(value);
    expect(await observeRequest(retry, meta, { mode: "block" })).toBeUndefined();
    expect(JSON.stringify(retry)).not.toContain(value);
  }, 10_000);
  it("counts invalid known-list errors", async () => {
    await writeFile(known, "not-json");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await observeRequest(body(value), meta);
    expect(health()).toMatchObject({ errors: 1, lastError: { stage: "known" } });
  });
});
describe("PII guard test preview", () => {
  it("previews redact and block without request side effects", async () => {
    const { testText } = await import("../../src/lib/piiGuard/observe.js");
    const r = await testText("mobile 9876543210", { mode: "redact" });
    expect(r.findings[0]).toMatchObject({ rule: "in_phone", action: "redact" });
    expect(r.redacted).toMatch(/^mobile \{\{pii:in_phone#/);
    expect((await testText("mobile 9876543210", { mode: "block" })).blocked).toEqual(["in_phone"]);
    const audit = (await readFile(events, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(audit).toHaveLength(2);
    expect(audit.every(event => event.type === "test" && !JSON.stringify(event).includes("9876543210"))).toBe(true);
  });
  it("never logs a value carried in model or user agent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = { model: `openai/${value}`, messages: [{ role: "user", content: "hi" }] };
    await observeRequest(b, { endpoint: "/v1/messages", userAgent: `${value} x`, model: b.model }, { mode: "redact" });
    const text = await lines(1);
    expect(b.model).not.toContain(value);
    expect(text + JSON.stringify(warn.mock.calls)).not.toContain(value);
  });
  it("keeps pattern hashes stable across restarts without a known list", async () => {
    await rm(known);
    const key = "sk-proj-" + "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
    await observeRequest(body(key), meta);
    const first = JSON.parse((await lines(1)).trim()).new[0].hash;
    vi.resetModules();
    ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));
    await observeRequest(body(key), meta);
    expect(JSON.parse((await lines(2)).trim().split("\n")[1]).hits[0].hash).toBe(first);
  });
  it("skips events when every finding is off", async () => {
    await observeRequest(body(value), meta, { mode: "observe", rules: { known: "off" } });
    await new Promise(resolve => setTimeout(resolve, 50));
    await expect(stat(events)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps blocking a seen value that cannot be redacted", async () => {
    const b = () => ({ messages: [{ role: "user", content: "hi" }], metadata: { [value]: 1 } });
    expect(await observeRequest(b(), meta, { mode: "block" })).toMatchObject({ blocked: ["own-test"] });
    expect(await observeRequest(b(), meta, { mode: "block" })).toMatchObject({ blocked: ["own-test"] });
    expect((await observeRequest(b(), meta, { mode: "block" })).stuck).toBeUndefined();
  });
  const thinking = (loop) => ({ messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "thinking", thinking: `note ${value}`, signature: "sig" }, { type: "tool_use", id: "t1", name: "x", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ...(loop ? [] : [{ role: "assistant", content: [{ type: "text", text: "done" }] }, { role: "user", content: "next" }]),
  ] });
  it("drops signed thinking with a value from earlier turns instead of leaking it", async () => {
    const first = await observeRequest(thinking(false), meta, { mode: "block" });
    expect(first).toMatchObject({ blocked: ["own-test"] });
    expect(first.stuck).toBeUndefined();
    const b = thinking(false);
    expect(await observeRequest(b, meta, { mode: "block" })).toBeUndefined();
    expect(b.messages[1].content.map(c => c.type)).toEqual(["tool_use"]);
    expect(JSON.stringify(b)).not.toContain(value);
  });
  it("blocks signed thinking in the active tool loop with a /rewind hint", async () => {
    const b = thinking(true);
    expect(await observeRequest(b, meta, { mode: "block" })).toMatchObject({ blocked: ["own-test"], stuck: true });
    expect(await observeRequest(thinking(true), meta, { mode: "block" })).toMatchObject({ stuck: true });
    expect(b.messages[1].content[0].thinking).toContain(value);
    const { blockMessage } = await import("../../src/lib/piiGuard/observe.js");
    expect(blockMessage(["own-test"], true, true)).toContain("/rewind");
    expect(blockMessage(["own-test"], true, true)).not.toContain("retry and it will be redacted");
    await observeRequest(thinking(true), meta, { mode: "redact" });
    const event = JSON.parse((await lines(3)).trim().split("\n")[2]);
    expect(event.hits[0]).toMatchObject({ action: "leaked", where: "assistant/thinking" });
  });
  it("keeps thinking of every assistant message in the open tool loop", async () => {
    const b = thinking(true);
    b.messages.push({ role: "assistant", content: [{ type: "thinking", thinking: "more", signature: "s2" }, { type: "tool_use", id: "t2", name: "x", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }] });
    expect(await observeRequest(b, meta, { mode: "block" })).toMatchObject({ stuck: true });
    expect(await observeRequest(b, meta, { mode: "block" })).toMatchObject({ stuck: true });
    expect(b.messages[1].content[0].type).toBe("thinking");
  });
  it("ignores unknown preview locations", async () => {
    const { testText } = await import("../../src/lib/piiGuard/observe.js");
    expect((await testText(`x ${value}`, { mode: "redact" }, "__proto__")).redacted).not.toContain(value);
    expect((await testText(`x ${value}`, { mode: "redact" }, "constructor")).redacted).not.toContain(value);
  });
  it("previews where a value sits", async () => {
    const { testText } = await import("../../src/lib/piiGuard/observe.js");
    const r = await testText(`x ${value}`, { mode: "redact" }, "thinking");
    expect(r.findings[0].action).toBe("leaked");
    expect(r.before).toBe(`x ${value}`);
    const s = await testText(`x ${value}`, { mode: "redact" }, "system");
    expect(s.redacted).not.toContain(value);
  });
  it("reports leaked over redacted for the same value and source", async () => {
    const b = { messages: [{ role: "user", content: [{ type: "text", text: value }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA", note: value } }] }] };
    await observeRequest(b, meta, { mode: "redact" });
    const event = JSON.parse((await lines(1)).trim());
    expect(event.leaked).toBeTruthy();
    expect(event.hits.some(h => h.action === "leaked")).toBe(true);
  });
});

describe("PII guard rules() metadata", () => {
  let dir, fakeModule;
  beforeEach(async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    dir = await mkdtemp(join(tmpdir(), "pii-rules-"));
    fakeModule = join(dir, "scanner.js");
    await writeFile(fakeModule, `
      export function createDetector({ salt }) { return { knownCount: 3, scan() { return []; }, placeholder(f) { return "{{pii:" + f.rule + "}}"; } }; }
      export function scanBody() { return { findings: [], chars: 0, images: 0, imageBytes: 0, unscanned: {} }; }
      export const RULES = [ { id: "foo", kind: "secret" }, { id: "bar", kind: "pii" } ];
    `);
    process.env.PII_GUARD_MODULE = fakeModule;
    process.env.PII_GUARD_KNOWN = join(dir, "missing-known.json");
    process.env.PII_GUARD_EVENTS = join(dir, "events", "events.jsonl");
  });
  afterEach(async () => {
    delete process.env.PII_GUARD_MODULE; delete process.env.PII_GUARD_KNOWN; delete process.env.PII_GUARD_EVENTS;
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });
  it("returns group and label, with fallbacks for older builds", async () => {
    const { ready, rules, groups } = await import("../../src/lib/piiGuard/observe.js");
    expect(await ready()).toBe(true);
    expect(rules()).toEqual([
      { id: "known", kind: "known", group: "known", label: "Vault values", count: 3 },
      { id: "foo", kind: "secret", group: "api_key", label: "foo" },
      { id: "bar", kind: "pii", group: "other", label: "bar" },
    ]);
    expect(groups()).toEqual([
      { id: "api_key", label: "API keys and secrets" },
      { id: "known", label: "Vault values" },
      { id: "gov_id", label: "Government IDs" },
      { id: "financial", label: "Financial" },
      { id: "contact", label: "Contact" },
      { id: "network", label: "Network" },
    ]);
  });
});
