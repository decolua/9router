import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { buildKiroAdditionalModelRequestFieldsForModel } from "../../open-sse/config/kiroConstants.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("getThinkingLevels for Kiro", () => {
  it("does not advertise native intensity for legacy Kiro models", () => {
    expect(getThinkingLevels("kiro", "claude-sonnet-4.5")).toBeNull();
    expect(getThinkingLevels("kiro", "glm-5")).toBeNull();
  });

  it("advertises native levels for supported Kiro models", () => {
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("high");
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("xhigh");
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("max");
    expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toContain("xhigh");
  });

  it("omits xhigh on 4.6 models (upstream rejects it there)", () => {
    for (const model of ["claude-opus-4.6", "claude-opus-4-6", "claude-sonnet-4.6"]) {
      expect(getThinkingLevels("kiro", model)).not.toContain("xhigh");
      expect(getThinkingLevels("kiro", model)).toContain("max");
    }
  });

  it("passes xhigh/max through on the wire for 4.7+, clamps xhigh on 4.6", () => {
    const xhigh = { output_config: { effort: "xhigh" } };
    expect(buildKiroAdditionalModelRequestFieldsForModel(xhigh, "claude-sonnet-5")?.output_config?.effort).toBe("xhigh");
    expect(buildKiroAdditionalModelRequestFieldsForModel({ output_config: { effort: "max" } }, "claude-opus-4.6")?.output_config?.effort).toBe("max");
    expect(buildKiroAdditionalModelRequestFieldsForModel(xhigh, "claude-opus-4.6")?.output_config?.effort).toBe("high");
    // Anthropic-wire path: suffix override sends real xhigh on 4.7+, high on 4.6.
    expect(applyThinking("claude", "claude-opus-5.5(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("xhigh");
    expect(applyThinking("claude", "claude-opus-4.6(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("high");
  });
});
