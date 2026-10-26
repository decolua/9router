import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

describe("normalizeClaudePassthrough — Haiku adaptive thinking (#5183)", () => {
  it("keeps adaptive thinking and effort for Haiku 5.5 models", () => {
    const models = [
      "claude-haiku-5-5",
      "claude-haiku-5.5",
      "anthropic/claude-haiku-5-5",
      "claude-haiku-6", // a future generation must not be downgraded either
    ];

    for (const model of models) {
      const body = {
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "low" },
      };
      const out = normalizeClaudePassthrough(body, model);
      expect(out.thinking, `model ${model} should keep adaptive thinking`).toEqual({
        type: "adaptive",
        display: "summarized",
      });
      expect(out.output_config, `model ${model} should keep output_config.effort`).toEqual({
        effort: "low",
      });
    }
  });

  it("downgrades adaptive thinking and strips effort for Haiku 3.x and 4.x models", () => {
    const models = [
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "claude-4.5-haiku",
      "claude-haiku-4-5-20251001",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
    ];

    for (const model of models) {
      const body = {
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      };
      const out = normalizeClaudePassthrough(body, model);
      expect(out.thinking, `model ${model} should downgrade thinking`).toEqual({
        type: "enabled",
        budget_tokens: 10000,
      });
      expect(out.output_config, `model ${model} should strip effort`).toBeUndefined();
    }
  });

  it("leaves non-haiku models untouched", () => {
    const body = {
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    };
    const out = normalizeClaudePassthrough(body, "claude-sonnet-4-6");
    expect(out.thinking).toEqual({ type: "adaptive" });
    expect(out.output_config).toEqual({ effort: "medium" });
  });
});
