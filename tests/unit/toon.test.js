import { describe, it, expect, beforeEach } from "vitest";
import { compressMessages, setRtkEnabled } from "../../open-sse/rtk/index.js";
import { tryToon, applyToon, formatToonLog } from "../../open-sse/rtk/toon.js";

function makeLongDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

describe("tryToon", () => {
  it("returns null for non-JSON text", () => {
    expect(tryToon("hello world")).toBeNull();
    expect(tryToon("")).toBeNull();
    expect(tryToon(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(tryToon("{broken")).toBeNull();
  });

  it("returns TOON when it saves bytes on objects", () => {
    const json = JSON.stringify({ name: "Alice", age: 30, active: true });
    const out = tryToon(json);
    expect(out).not.toBeNull();
    expect(out.length).toBeLessThan(json.length);
  });

  it("returns TOON when it saves bytes on arrays", () => {
    const json = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const out = tryToon(json);
    expect(out).not.toBeNull();
    expect(out.length).toBeLessThan(json.length);
  });

  it("returns null when JSON is already smaller than TOON", () => {
    const json = '"a"';
    expect(tryToon(json)).toBeNull();
  });
});

describe("applyToon", () => {
  it("returns null when disabled", () => {
    const json = JSON.stringify({ results: [{ id: 1, name: "x" }] });
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: json }] };
    expect(applyToon(body, false)).toBeNull();
  });

  it("compresses JSON tool content when enabled", () => {
    const json = JSON.stringify({ results: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}`, ok: true })) });
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: json }] };
    const stats = applyToon(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(stats.hits[0].filter).toBe("toon");
    expect(body.messages[0].content.length).toBeLessThan(json.length);
  });

  it("does not interfere with RTK when both run", () => {
    setRtkEnabled(true);
    const big = makeLongDiff();
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: big }] };
    const rtkStats = compressMessages(body);
    const hasGitDiff = rtkStats.hits.some(h => h.filter === "git-diff");
    expect(hasGitDiff).toBe(true);
  });

  it("skips below MIN_COMPRESS_SIZE", () => {
    const json = '{"a":1}';
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: json }] };
    const stats = applyToon(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content).toBe(json);
  });

  it("skips is_error tool_result", () => {
    const json = JSON.stringify({ error: "something went wrong" });
    const body = {
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: json, is_error: true }]
      }]
    };
    const stats = applyToon(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content[0].content).toBe(json);
  });
});

describe("formatToonLog", () => {
  it("returns null when no hits", () => {
    expect(formatToonLog({ bytesBefore: 0, bytesAfter: 0, hits: [] })).toBeNull();
  });
  it("formats savings line with percentage", () => {
    const line = formatToonLog({ bytesBefore: 1000, bytesAfter: 400, hits: [{ filter: "toon" }] });
    expect(line).toContain("saved 600B");
    expect(line).toContain("60.0%");
    expect(line).toContain("TOON");
  });
});
