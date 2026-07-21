import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(model, overrides = {}) {
  const executor = new CodexExecutor();
  return executor.transformRequest(model, {
    model,
    input: "Reply only OK",
    ...overrides,
  }, true, {});
}

describe("Codex reasoning effort capabilities", () => {
  it.each(["sol", "terra", "luna"])("preserves max for GPT-5.6 %s", (variant) => {
    const body = transform(`gpt-5.6-${variant}`, { reasoning_effort: "max" });
    expect(body.model).toBe(`gpt-5.6-${variant}`);
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto" });
  });

  it("parses max suffix before resolving a review alias", () => {
    const body = transform("gpt-5.6-sol-review-max");
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("max");
  });

  it("keeps the legacy max to xhigh mapping for legacy models", () => {
    const body = transform("gpt-5.5", { reasoning: { effort: "max" } });
    expect(body.reasoning.effort).toBe("xhigh");
  });

  it("rejects undeclared GPT-5.6 efforts instead of sending them upstream", () => {
    expect(() => transform("gpt-5.6-sol", { reasoning_effort: "ultra" }))
      .toThrow('Unsupported reasoning effort "ultra" for Codex model "gpt-5.6-sol"');
  });
});
