import { describe, it, expect } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

/**
 * `cx/gpt-6-luna-low` names an effort: the suffix is stripped from the model id
 * and becomes `reasoning.effort`. It used to count only when the client sent no
 * effort of its own — and agents (Codex CLI, Claude Code, …) always send one,
 * so the suffix the operator typed was silently thrown away and the model ran
 * at the client's default. The `(low)` spelling already won over the client
 * (thinkingUnified); the dash spelling now does too.
 */

const run = (model, extra = {}) => new CodexExecutor().transformRequest(model, { model, input: "hi", ...extra }, true, {});

describe("an effort written into the model id", () => {
  it("is used, and stripped from the model sent upstream", () => {
    const body = run("gpt-6-luna-low");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("low");
  });

  it("wins over a reasoning_effort the client sent", () => {
    const body = run("gpt-6-luna-low", { reasoning_effort: "medium" });
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("low");
  });

  it("wins over a reasoning object the client sent, keeping the rest of it", () => {
    const body = run("gpt-6-luna-high", { reasoning: { effort: "low", summary: "detailed" } });
    expect(body.reasoning.effort).toBe("high");
    expect(body.reasoning.summary).toBe("detailed");
  });

  it("covers every level the model accepts", () => {
    for (const level of ["low", "medium", "high"]) {
      expect(run(`gpt-6-astra-${level}`, { reasoning_effort: "xhigh" }).reasoning.effort, level).toBe(level);
    }
  });
});

describe("a model id without an effort", () => {
  it("keeps the client's effort", () => {
    expect(run("gpt-6-luna", { reasoning_effort: "medium" }).reasoning.effort).toBe("medium");
    expect(run("gpt-6-luna", { reasoning: { effort: "high" } }).reasoning.effort).toBe("high");
  });

  it("does not mistake part of the name for an effort", () => {
    // "-review" is a virtual model that maps to its upstream one, not a level.
    const body = run("gpt-5.6-sol-review", { reasoning_effort: "medium" });
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("medium");
  });
});
