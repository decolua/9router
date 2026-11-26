// Regression tests for #5268: advertised output cap must match the gateway cap.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Command Code output limit advertised by /v1/models", () => {
  it("caps the generic Command Code fallback at the gateway's 200k limit", () => {
    const caps = getCapabilitiesForModel("commandcode", "deepseek/deepseek-v4.1-flash");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(200000);
  });

  it("uses the same cap for the cmc wire alias", () => {
    const caps = getCapabilitiesForModel("cmc", "z-ai/glm-5.3-flash");
    expect(caps.maxOutput).toBe(200000);
  });

  it("keeps the narrower per-model provider entry", () => {
    const caps = getCapabilitiesForModel("commandcode", "claude-haiku-5-5");
    expect(caps.maxOutput).toBe(128000);
  });
});
