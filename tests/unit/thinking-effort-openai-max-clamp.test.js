import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// GPT-5.6 wire matrix for OpenAI-format reasoning_effort:
// Sol/Terra preserve max+ultra; Luna preserves max, ultra→max;
// older/unrelated max/ultra → xhigh (legacy safe clamp).
describe("applyThinking (openai): model-aware effort fallback", () => {
  describe("legacy older models (max/ultra → xhigh)", () => {
    it("client output_config.effort:\"max\" → reasoning_effort:\"xhigh\" (not \"max\")", () => {
      const body = { output_config: { effort: "max" } };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("xhigh");
    });

    it("direct reasoning_effort:\"max\" clamped to \"xhigh\"", () => {
      const body = { reasoning_effort: "max" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("xhigh");
    });

    it("direct reasoning_effort:\"ultra\" clamped to \"xhigh\"", () => {
      const body = { reasoning_effort: "ultra" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("xhigh");
    });

    it("gpt-5.5 max → xhigh", () => {
      const body = { reasoning_effort: "max" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.5", body, "codex");
      expect(out.reasoning_effort).toBe("xhigh");
    });

    it("\"xhigh\" passes through unchanged (highest valid OpenAI level)", () => {
      const body = { reasoning_effort: "xhigh" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("xhigh");
    });

    it("\"high\" passes through unchanged", () => {
      const body = { reasoning_effort: "high" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("high");
    });

    it("max budget (thinking.budget_tokens:128000) → reasoning_effort:\"xhigh\" (budgetToLevel caps at xhigh)", () => {
      const body = { thinking: { type: "enabled", budget_tokens: 128000 } };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
      expect(out.reasoning_effort).toBe("xhigh");
    });
  });

  describe("gpt-5.6-sol preserves max and ultra", () => {
    it("max preserved", () => {
      const body = { reasoning_effort: "max" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", body, "codex");
      expect(out.reasoning_effort).toBe("max");
    });

    it("ultra preserved", () => {
      const body = { reasoning_effort: "ultra" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", body, "codex");
      expect(out.reasoning_effort).toBe("ultra");
    });

    it("output_config.effort max preserved", () => {
      const body = { output_config: { effort: "max" } };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", body, "codex");
      expect(out.reasoning_effort).toBe("max");
    });
  });

  describe("gpt-5.6-terra preserves max and ultra", () => {
    it("max preserved", () => {
      const body = { reasoning_effort: "max" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-terra", body, "openai");
      expect(out.reasoning_effort).toBe("max");
    });

    it("ultra preserved", () => {
      const body = { reasoning_effort: "ultra" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-terra", body, "openai");
      expect(out.reasoning_effort).toBe("ultra");
    });
  });

  describe("gpt-5.6-luna preserves max; ultra → max", () => {
    it("max preserved", () => {
      const body = { reasoning_effort: "max" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-luna", body, "openai");
      expect(out.reasoning_effort).toBe("max");
    });

    it("ultra maps to max (nearest supported sibling)", () => {
      const body = { reasoning_effort: "ultra" };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-luna", body, "openai");
      expect(out.reasoning_effort).toBe("max");
    });

    it("output_config.effort ultra → max", () => {
      const body = { output_config: { effort: "ultra" } };
      const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-luna", body, "openai");
      expect(out.reasoning_effort).toBe("max");
    });
  });
});
