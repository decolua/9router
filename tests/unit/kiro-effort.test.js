// Unit tests for resolveKiroEffort — maps client thinking intent to the
// output_config.effort level Kiro accepts natively (per official docs).
import { describe, it, expect } from "vitest";
import { resolveKiroEffort } from "../../open-sse/config/kiroConstants.js";

describe("resolveKiroEffort", () => {
  it("passes reasoning_effort levels through", () => {
    expect(resolveKiroEffort({ reasoning_effort: "low" })).toBe("low");
    expect(resolveKiroEffort({ reasoning_effort: "medium" })).toBe("medium");
    expect(resolveKiroEffort({ reasoning_effort: "high" })).toBe("high");
    expect(resolveKiroEffort({ reasoning_effort: "max" })).toBe("max");
  });

  it("xhigh clamps to high on Opus 4.6 / Sonnet 4.6 (unsupported)", () => {
    expect(resolveKiroEffort({ reasoning_effort: "xhigh" }, "claude-opus-4-6")).toBe("high");
    expect(resolveKiroEffort({ reasoning_effort: "xhigh" }, "claude-sonnet-4-6")).toBe("high");
  });

  it("xhigh passes through on Opus 4.7 / 4.8", () => {
    expect(resolveKiroEffort({ reasoning_effort: "xhigh" }, "claude-opus-4-7")).toBe("xhigh");
    expect(resolveKiroEffort({ reasoning_effort: "xhigh" }, "claude-opus-4-8")).toBe("xhigh");
  });

  it("maps Claude thinking.budget_tokens via budgetToLevel", () => {
    // 20000 tokens → "high" (≤ 28672)
    expect(resolveKiroEffort({ thinking: { type: "enabled", budget_tokens: 20000 } })).toBe("high");
    // 4096 tokens → "low"
    expect(resolveKiroEffort({ thinking: { type: "enabled", budget_tokens: 4096 } })).toBe("low");
  });

  it("returns null when thinking is explicitly disabled", () => {
    expect(resolveKiroEffort({ reasoning_effort: "none" })).toBeNull();
    expect(resolveKiroEffort({ thinking: { type: "disabled" } })).toBeNull();
  });

  it("auto / no intent → high (preserves default-on)", () => {
    expect(resolveKiroEffort({ reasoning_effort: "auto" })).toBe("high");
    expect(resolveKiroEffort({ messages: [] })).toBe("high");
  });
});
