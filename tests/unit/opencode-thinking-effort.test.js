import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// Regression: OpenCode zen stealth/free originals (x-preview-f-free aka ox-alpha,
// big-pickle, muse-spark-1.2, mimo-v2.5-free) matched no capability pattern →
// caps.reasoning=false → applyThinking() stripped the thinking intent entirely,
// so reasoning_effort never reached the gateway. Verified live: zen accepts
// reasoning_effort none|low|medium|high|max and rejects xhigh/minimal/auto.
describe("opencode thinking effort", () => {
  it("stealth ids resolve reasoning:true with the opencode format", () => {
    for (const id of ["x-preview-f-free", "big-pickle", "muse-spark-1.2", "mimo-v2.5-free"]) {
      const caps = getCapabilitiesForModel("opencode", id);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("opencode");
    }
  });

  it("claude budget intent → reasoning_effort on x-preview-f-free (was stripped)", () => {
    const body = { messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled", budget_tokens: 64000 } };
    const out = applyThinking(FORMATS.OPENAI, "x-preview-f-free", body, "opencode");
    expect(out.reasoning_effort).toBe("max");
  });

  it("gateway enum: xhigh/ultra clamp to max, minimal clamps to low", () => {
    const xhigh = applyThinking(FORMATS.OPENAI, "big-pickle", { reasoning_effort: "xhigh" }, "opencode");
    expect(xhigh.reasoning_effort).toBe("max");
    const ultra = applyThinking(FORMATS.OPENAI, "big-pickle", { reasoning_effort: "ultra" }, "opencode");
    expect(ultra.reasoning_effort).toBe("max");
    const minimal = applyThinking(FORMATS.OPENAI, "big-pickle", { reasoning_effort: "minimal" }, "opencode");
    expect(minimal.reasoning_effort).toBe("low");
  });

  it("none disables explicitly, auto omits the field (upstream default)", () => {
    const none = applyThinking(FORMATS.OPENAI, "x-preview-f-free", { reasoning_effort: "none" }, "opencode");
    expect(none.reasoning_effort).toBe("none");
    const auto = applyThinking(FORMATS.OPENAI, "x-preview-f-free", { reasoning_effort: "auto" }, "opencode");
    expect(auto.reasoning_effort).toBeUndefined();
  });

  it("provider format wins over per-model caps: claude id on opencode gets reasoning_effort, not claude thinking blocks", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.OPENAI, "claude-sonnet-4-6",
      { messages: [{ role: "user", content: "hi" }], output_config: { effort: "high" } },
      true, null, "opencode"
    );
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("UI levels expose the gateway enum (incl. max) for stealth and vendor ids", () => {
    expect(getThinkingLevels("opencode", "x-preview-f-free")).toEqual(["none", "low", "medium", "high", "max"]);
    expect(getThinkingLevels("opencode", "gpt-5.6-sol")).toEqual(["none", "low", "medium", "high", "max"]);
  });

  it("other providers unaffected", () => {
    expect(getThinkingLevels("openai", "gpt-5")).toContain("xhigh");
    expect(getThinkingLevels("openai", "gpt-5")).not.toContain("max");
    expect(getCapabilitiesForModel("openai", "gpt-5").thinkingFormat).toBe("openai");
  });
});
