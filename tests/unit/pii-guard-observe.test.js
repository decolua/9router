import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const modulePath = "/home/chetan/Projects/pii-guard/dist/index.js";
const value = "synthetic-own-value-739201";
let dir, events, known, observeRequest;
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
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), "pii-observe-"));
  events = join(dir, "events", "events.jsonl"); known = join(dir, "known.json");
  process.env.PII_GUARD_MODULE = modulePath; process.env.PII_GUARD_KNOWN = known; process.env.PII_GUARD_EVENTS = events;
  await writeKnown("own-test", value);
  ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));
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
