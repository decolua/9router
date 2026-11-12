import { describe, it, expect } from "vitest";
import { normalizeThinkingConfig } from "../../open-sse/services/provider.js";

describe("normalizeThinkingConfig", () => {
  it.each([
    { type: "enabled", budget_tokens: 4096 },
    { type: "adaptive" },
    { type: "disabled" },
  ])("keeps thinking $type on a tool-result turn", (thinking) => {
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: "done" }], thinking };
    expect(normalizeThinkingConfig(body).thinking).toEqual(thinking);
  });

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
