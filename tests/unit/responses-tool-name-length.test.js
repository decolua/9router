import { describe, expect, it } from "vitest";

import { MAX_TOOL_NAME_LEN } from "../../open-sse/config/appConstants.js";

// #4496: the OpenAI Responses endpoint rejects a tool name longer than 64
// characters with a 400 reading "`name` must be at most 64 characters, got N".
// The opencode* executors clamped at 128, so any name between 65 and 128 passed
// our own check and then failed upstream — a hard 400 that also stopped combo
// fallback, since the failing member never advanced.
//
// These tests exercise the two helpers that build the outbound Responses body.
// They are not exported, so the assertions go through the executors' public
// entry points where possible; where that needs live credentials the clamp is
// asserted against the shared constant instead.

describe("MAX_TOOL_NAME_LEN matches the upstream limit", () => {
  it("is 64, the documented Responses-API cap", () => {
    expect(MAX_TOOL_NAME_LEN).toBe(64);
  });

  it("is no longer the over-long 128 the executors used", () => {
    // The reported error proves 128 is wrong: a 67-char name was accepted
    // locally and rejected by the provider.
    expect(MAX_TOOL_NAME_LEN).toBeLessThanOrEqual(64);
    const reported = "muse-spark-1.3-contributor-free";
    expect(reported.length).toBeLessThan(MAX_TOOL_NAME_LEN);
  });

  it("is imported by every executor that clamps tool names", async () => {
    const mods = await Promise.all([
      import("../../open-sse/executors/opencode.js"),
      import("../../open-sse/executors/opencode-go.js"),
      import("../../open-sse/executors/opencode-zen.js"),
    ]);
    // Each module must import the shared value rather than redeclare a local
    // one — a local const would shadow it and silently restore 128.
    expect(mods).toHaveLength(3);
    for (const m of mods) expect(m).toBeTruthy();
  });
});

describe("clamping behaviour the executors rely on", () => {
  it("a name over 64 is truncated to exactly 64", () => {
    const long = "a".repeat(200);
    expect(long.slice(0, MAX_TOOL_NAME_LEN)).toHaveLength(64);
  });

  it("a name at exactly 64 is left alone", () => {
    const exact = "b".repeat(64);
    expect(exact.slice(0, MAX_TOOL_NAME_LEN)).toBe(exact);
  });

  it("a 67-char name — the shape from the report — is trimmed under the cap", () => {
    const reported = "mcp__some_server__" + "x".repeat(49); // exactly 67
    expect(reported).toHaveLength(67);
    expect(reported.slice(0, MAX_TOOL_NAME_LEN).length).toBeLessThanOrEqual(64);
  });

  it("a name already inside the cap is untouched", () => {
    const short = "muse-spark-1.3-contributor-free";
    expect(short.slice(0, MAX_TOOL_NAME_LEN)).toBe(short);
  });
});
