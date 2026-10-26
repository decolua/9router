// Regression for #4771: thinkingFormat "zai" emitted { type: "enabled" } without
// the mandatory budget_tokens on Anthropic-wire GLM upstreams → 400
// "missing field `budget_tokens`" on every thinking turn.
import { describe, it, expect } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

function run(model, effort) {
  const body = { reasoning_effort: effort };
  applyThinking("claude", model, body, "glm");
  return body;
}

describe("#4771 zai thinking budget_tokens", () => {
  it("glm-5.3 via anthropic wire always carries budget_tokens", () => {
    for (const effort of ["low", "medium", "high", "max"]) {
      const body = run("glm-5.3", effort);
      expect(body.thinking?.type).toBe("enabled");
      expect(body.thinking.budget_tokens).toBeTypeOf("number");
      expect(body.thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
    }
  });

  it("keeps reasoning_effort mapping intact", () => {
    const body = run("glm-5.3", "high");
    expect(body.reasoning_effort).toBe("high");
  });

  it("disables cleanly when canDisable and intent none", () => {
    const body = run("glm-4.5v", "none");
    expect(body.thinking?.type ?? "absent").not.toBe("enabled");
  });
});
