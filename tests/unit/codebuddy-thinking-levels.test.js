// Regression: Claude Code ultracode / "max" effort on CodeBuddy CN+INTL.
//
// Two defects made max-effort requests land on the wrong level:
//   1. normalizeOpenAILevel hard-clamped max/ultra to "xhigh" regardless of the
//      model's DECLARED ceiling — so a model declaring ["low","high"] received
//      "xhigh" (above its top), and a model declaring "max" never got it.
//   2. Provider-scoped PATTERN_THINKING entries were shadowed: the generic
//      `*deepseek-v4.*` rule (declares "max") sits ABOVE the codebuddy-specific
//      `deepseek-v4*` rule, so find() returned the generic set and the picker
//      advertised a "max" the gateway never honors.
import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const applyMax = (provider, model) => {
  const body = { reasoning_effort: "max" };
  return applyThinking(FORMATS.OPENAI, model, body, provider).reasoning_effort;
};

describe("normalizeOpenAILevel clamps to the model's declared ceiling", () => {
  it("clamps max DOWN to the lowest declared top (hy3: [low,high])", () => {
    expect(getThinkingLevels("codebuddy-intl", "hy3")).toEqual(["low", "high"]);
    expect(applyMax("codebuddy-intl", "hy3")).toBe("high");
  });

  it("clamps max to high when high is the only declared level (hy4-preview)", () => {
    expect(getThinkingLevels("codebuddy-intl", "hy4-preview")).toEqual(["high"]);
    expect(applyMax("codebuddy-intl", "hy4-preview")).toBe("high");
  });

  it("preserves max when the model actually declares it (glm-5.3)", () => {
    expect(getThinkingLevels("codebuddy-intl", "glm-5.3")).toContain("max");
    expect(applyMax("codebuddy-intl", "glm-5.3")).toBe("max");
  });

  it("keeps xhigh when the model declares xhigh (glm-5.2)", () => {
    expect(applyMax("codebuddy-intl", "glm-5.2")).toBe("xhigh");
  });
});

describe("provider-scoped level patterns are not shadowed by generic ones", () => {
  it("codebuddy deepseek-v4* uses the provider set, not the generic *deepseek-v4.*", () => {
    const intl = getThinkingLevels("codebuddy-intl", "deepseek-v4.1-flash");
    expect(intl).toEqual(["low", "high", "xhigh"]);
    expect(intl).not.toContain("max");
    // and therefore max clamps to xhigh rather than being passed through
    expect(applyMax("codebuddy-intl", "deepseek-v4.1-flash")).toBe("xhigh");

    const cn = getThinkingLevels("codebuddy-cn", "deepseek-v4-pro");
    expect(cn).toEqual(["low", "high", "xhigh"]);
  });
});
