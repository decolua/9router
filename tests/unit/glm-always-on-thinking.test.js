import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("GLM always-on reasoning (#4771)", () => {
  it.each([
    [{ thinking: { type: "enabled" } }, "max"],
    [{ thinking: { type: "enabled", budget_tokens: 8192 } }, "high"],
    [{ reasoning_effort: "high" }, "high"],
    [{ reasoning_effort: "max" }, "max"],
    [{ reasoning_effort: "none" }, "low"],
  ])("omits the redundant thinking block for intent %j", (seed, effort) => {
    for (const model of ["glm-5.3", "glm-5.3-flash"]) {
      const body = structuredClone(seed);
      applyThinking("claude", model, body, "glm");
      expect(body.thinking).toBeUndefined();
      expect(body.enable_thinking).toBeUndefined();
      // The exact Flash entry does not advertise an effort control.
      expect(body.reasoning_effort).toBe(model === "glm-5.3-flash" ? undefined : effort);
    }
  });

  it("keeps the enable/disable controls for earlier GLM models", () => {
    const enabled = { reasoning_effort: "high" };
    applyThinking("claude", "glm-5.1", enabled, "glm");
    expect(enabled.thinking).toEqual({ type: "enabled" });
    const disabled = { reasoning_effort: "none" };
    applyThinking("claude", "glm-5.1", disabled, "glm");
    expect(disabled.enable_thinking).toBe(false);
    expect(disabled.thinking).toBeUndefined();
  });

  it("preserves the OpenAI aggregator's reasoning format", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "glm-5.3", body, "openrouter");
    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toBeUndefined();
  });

  it("preserves native Z.ai enable markers on OpenAI transport", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "glm-5.3", body, "glm-cn");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });
});
