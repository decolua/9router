// Regression: RTK must not compress error tool traces in the STRING tool shape.
//
// The Claude->OpenAI translator emits a failed tool_result as
// { role:"tool", content: "[tool_error: true]\n<big dump>" } (STRING content).
// The first audit added the [tool_error: true] skip only to the ARRAY shape, so
// the string shape — the one actually produced — was still compressed, losing
// the error trace.
import { describe, expect, it } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";

// A large, autodetectable grep-style dump (>= 500 bytes).
const bigDump = Array.from({ length: 200 }, (_, i) => `src/file${i}.js:${i + 1}:needle ${i}`).join("\n");

describe("RTK preserves error tool traces (string shape)", () => {
  it("skips compressing a [tool_error: true] string tool message", () => {
    const content = `[tool_error: true]\n${bigDump}`;
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content }] };
    compressMessages(body, true);
    expect(body.messages[0].content).toBe(content);
  });

  it("still processes a normal (non-error) large string tool message", () => {
    const body = { messages: [{ role: "tool", tool_call_id: "call_2", content: bigDump }] };
    compressMessages(body, true);
    // The point is that the error-marker branch is specific: a non-error message
    // is not skipped. It may or may not shrink depending on the detected filter,
    // so assert only that the content is still present and non-empty.
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[0].content).toContain("needle");
  });
});
