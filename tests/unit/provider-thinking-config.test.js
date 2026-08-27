import { describe, it, expect } from "vitest";
import { hasThinkingConfig, normalizeThinkingConfig } from "../../open-sse/services/provider.js";

describe("hasThinkingConfig", () => {
  it.each([
    [{ reasoning_effort: "low" }, true],
    [{ reasoning: { effort: "low" } }, true],
    [{ output_config: { effort: "high" } }, true],
    [{ thinking: { type: "disabled" } }, true],
    [{ reasoning: { summary: "auto" } }, false],
    [{ messages: [] }, false],
  ])("detects explicit thinking config in %j", (body, expected) => {
    expect(hasThinkingConfig(body)).toBe(expected);
  });
});

describe("normalizeThinkingConfig", () => {
  it("keeps openai reasoning_effort on non-user turns", () => {
    const body = {
      messages: [{ role: "assistant", content: "ok" }],
      reasoning_effort: "xhigh",
      thinking: { type: "enabled" },
    };

    normalizeThinkingConfig(body);

    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.thinking).toBeUndefined();
  });
});
