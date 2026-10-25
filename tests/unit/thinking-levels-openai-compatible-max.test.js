import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// Issue #5186: GPT-5.6 / GPT-6 on OpenAI Compatible nodes silently downgrade
// effort "max" to "xhigh" because the openai level set has no "max".
// These models take the full effort enum including "max", so the level list
// must include it for openai-compatible-* providers.
describe("getThinkingLevels: max effort for GPT-5.6/6 on OpenAI Compatible nodes", () => {
  it.each(["openai-compatible-foo", "openai-compatible-bar"])(
    "provider %s, gpt-6 model includes max",
    (provider) => {
      expect(getThinkingLevels(provider, "gpt-6")).toContain("max");
    }
  );

  it("provider openai-compatible-foo, gpt-5.6 model includes max", () => {
    expect(getThinkingLevels("openai-compatible-foo", "gpt-5.6")).toContain("max");
  });

  it("other providers unchanged: plain gpt-5 on openai has no max", () => {
    expect(getThinkingLevels("openai", "gpt-5")).not.toContain("max");
  });
});
