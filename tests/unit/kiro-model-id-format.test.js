import { describe, expect, it } from "vitest";
import { toKiroModelId, resolveKiroModel } from "../../open-sse/config/kiroConstants.js";

/**
 * Guards fix for issue #2308:
 * Kiro API rejects Claude model IDs with dot notation (claude-sonnet-4.5)
 * and requires dash notation (claude-sonnet-4-5).
 */
describe("toKiroModelId", () => {
  it("converts dot version separators to dashes for Claude models", () => {
    expect(toKiroModelId("claude-sonnet-4.5")).toBe("claude-sonnet-4-5");
    expect(toKiroModelId("claude-haiku-4.5")).toBe("claude-haiku-4-5");
    expect(toKiroModelId("claude-opus-4.8")).toBe("claude-opus-4-8");
  });

  it("leaves non-Claude model IDs unchanged", () => {
    expect(toKiroModelId("deepseek-3.2")).toBe("deepseek-3.2");
    expect(toKiroModelId("MiniMax-M2.5")).toBe("MiniMax-M2.5");
    expect(toKiroModelId("qwen3-coder-next")).toBe("qwen3-coder-next");
    expect(toKiroModelId("glm-5")).toBe("glm-5");
  });

  it("handles model IDs with no dots", () => {
    expect(toKiroModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });

  it("is idempotent on already-correct IDs", () => {
    const id = "claude-sonnet-4-5";
    expect(toKiroModelId(id)).toBe(id);
  });
});

describe("resolveKiroModel + toKiroModelId pipeline", () => {
  it("strips synthetic suffixes then normalises to dash notation", () => {
    const { upstream } = resolveKiroModel("claude-sonnet-4.5-thinking-agentic");
    expect(upstream).toBe("claude-sonnet-4.5");
    expect(toKiroModelId(upstream)).toBe("claude-sonnet-4-5");
  });

  it("handles thinking-only suffix", () => {
    const { upstream } = resolveKiroModel("claude-haiku-4.5-thinking");
    expect(toKiroModelId(upstream)).toBe("claude-haiku-4-5");
  });

  it("handles agentic-only suffix", () => {
    const { upstream } = resolveKiroModel("claude-sonnet-4.5-agentic");
    expect(toKiroModelId(upstream)).toBe("claude-sonnet-4-5");
  });

  it("leaves non-Claude models unchanged through the pipeline", () => {
    const { upstream } = resolveKiroModel("deepseek-3.2");
    expect(toKiroModelId(upstream)).toBe("deepseek-3.2");
  });
});
