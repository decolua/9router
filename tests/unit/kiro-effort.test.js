// Unit tests for resolveKiroEffort + resolveKiroMaxTokens — effort is the
// output_config.effort level; max_tokens is its effort-derived sibling inside
// additionalModelRequestFields (per the live additionalModelRequestFieldsSchema).
import { describe, it, expect } from "vitest";
import { resolveKiroEffort, resolveKiroMaxTokens } from "../../open-sse/config/kiroConstants.js";

describe("resolveKiroMaxTokens", () => {
  it("maps effort levels to clean buckets", () => {
    expect(resolveKiroMaxTokens("low", "claude-opus-4-8")).toBe(16000);
    expect(resolveKiroMaxTokens("medium", "claude-opus-4-8")).toBe(32000);
    expect(resolveKiroMaxTokens("high", "claude-opus-4-8")).toBe(64000);
    expect(resolveKiroMaxTokens("xhigh", "claude-opus-4-8")).toBe(96000);
    expect(resolveKiroMaxTokens("max", "claude-opus-4-8")).toBe(128000);
  });

  it("clamps to the per-model ceiling (opus-4-6 / sonnet-4-6 = 64000)", () => {
    expect(resolveKiroMaxTokens("max", "claude-opus-4-6")).toBe(64000);
    expect(resolveKiroMaxTokens("max", "claude-sonnet-4-6")).toBe(64000);
    expect(resolveKiroMaxTokens("xhigh", "claude-opus-4-6")).toBe(64000);
  });

  it("opus-4-7 ceiling is 128000 on the live gateway (docs table is stale)", () => {
    expect(resolveKiroMaxTokens("max", "claude-opus-4-7")).toBe(128000);
  });

  it("returns null when effort is unset (thinking off → omit max_tokens)", () => {
    expect(resolveKiroMaxTokens(null, "claude-opus-4-8")).toBeNull();
  });

  it("returns null for models without a max_tokens schema (omit the field)", () => {
    expect(resolveKiroMaxTokens("high", "some-other-model")).toBeNull();
    expect(resolveKiroMaxTokens("max", "deepseek-3.2")).toBeNull();
  });
});

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
