import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import {
  registerCustomModelCaps,
  getCustomModelCapsOverride,
  _clearCustomModelCaps,
} from "../../open-sse/providers/customModelCaps.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro Claude Opus 5 variants as 1M adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(getCapabilitiesForModel("kiro", model)).toMatchObject(claudeSonnet5Expected);
    }
  });

  it("reports Claude Fable 5.1 as a permanent adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("claude", "claude-fable-5-1")).toMatchObject({
      ...claudeSonnet5Expected,
      thinkingCanDisable: false,
    });
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "openai/gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-agentic")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toMatchObject(kiroGpt56Expected);
  });
});

describe("custom-model capability overrides", () => {
  it("floors an unknown custom model to text-only (no vision/reasoning) by default", () => {
    const caps = getCapabilitiesForModel("myprovider", "some-random-model");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
  });

  it("honors explicit overrides passed as the 3rd argument", () => {
    const caps = getCapabilitiesForModel("myprovider", "some-random-model", { vision: true, reasoning: true });
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    // reasoning:true with no format defaults to the openai reasoning_effort channel
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("lets a vision-only override keep reasoning off", () => {
    const caps = getCapabilitiesForModel("myprovider", "some-random-model", { vision: true });
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(false);
  });

  it("overrides win over a matched registry pattern (force-disable vision on a known vision model)", () => {
    // gpt-4o matches a vision:true pattern; an explicit override must be able to turn it off.
    const caps = getCapabilitiesForModel("openai", "gpt-4o", { vision: false });
    expect(caps.vision).toBe(false);
  });

  it("applies registry-registered caps when no explicit override is passed (deep call sites)", () => {
    _clearCustomModelCaps();
    registerCustomModelCaps("myprovider", "my-vision-model", { vision: true, reasoning: true });
    // no 3rd arg — simulates thinkingUnified/thinkingLevels deep calls
    const caps = getCapabilitiesForModel("myprovider", "my-vision-model");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    _clearCustomModelCaps();
  });

  it("registry lookup resolves both prefixed and base model ids", () => {
    _clearCustomModelCaps();
    registerCustomModelCaps("myprovider", "vendor/my-model", { vision: true });
    expect(getCustomModelCapsOverride("myprovider", "vendor/my-model")).toMatchObject({ vision: true });
    expect(getCustomModelCapsOverride("myprovider", "my-model")).toMatchObject({ vision: true });
    _clearCustomModelCaps();
  });
});
