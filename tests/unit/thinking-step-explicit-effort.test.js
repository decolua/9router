import { describe, expect, it } from "vitest";
import { applyThinking, captureThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const model = "step-5-preview-free";
const provider = "openai-compatible-step";

describe("Step explicit reasoning effort (#4931)", () => {
  it.each(["max", "xhigh"])("preserves explicit reasoning_effort %s", (level) => {
    const body = { reasoning_effort: level };
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body.reasoning_effort).toBe(level);
  });

  it.each(["max", "xhigh"])("preserves a %s model suffix over a conflicting body effort", (level) => {
    const body = { reasoning_effort: "low" };
    applyThinking(FORMATS.OPENAI, `${model}(${level})`, body, provider);
    expect(body.reasoning_effort).toBe(level);
  });

  it.each(["max", "xhigh"])("preserves captured Responses effort %s after translation", (level) => {
    const intent = captureThinking({ reasoning: { effort: level } });
    const body = {};
    applyThinking(FORMATS.OPENAI, model, body, provider, intent);
    expect(body.reasoning_effort).toBe(level);
  });

  it.each(["low", "medium", "high"])("retains the existing %s effort behavior", (level) => {
    const body = { reasoning_effort: level };
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body.reasoning_effort).toBe(level);
  });

  it.each([32768, 128000])("retains high as the conversion of a %i token budget", (budget) => {
    const body = { thinking: { type: "enabled", budget_tokens: budget } };
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body.reasoning_effort).toBe("high");
  });

  it("retains disabled thinking", () => {
    const body = { reasoning_effort: "none" };
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("retains automatic thinking", () => {
    const body = { reasoning_effort: "auto" };
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body.reasoning_effort).toBe("auto");
  });

  it("leaves a request without thinking intent alone", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const original = structuredClone(body);
    applyThinking(FORMATS.OPENAI, model, body, provider);
    expect(body).toEqual(original);
  });
});
