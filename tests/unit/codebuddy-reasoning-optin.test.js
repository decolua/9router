// #2071 — CodeBuddy forced reasoning_effort:"medium" + reasoning_summary:"auto"
// on requests where the client never asked for reasoning, tripping CodeBuddy's
// content filter ("model return error"). Reasoning params must be opt-in.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

describe("CodeBuddyExecutor reasoning params are opt-in (#2071)", () => {
  const exec = new CodeBuddyExecutor();

  it("does NOT force reasoning when the client did not request it", () => {
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "user", content: "hi" }] }, false, {});
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });

  it("mirrors reasoning_summary:auto when the client explicitly requested reasoning", () => {
    const out = exec.transformRequest(
      "glm-5.2",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning_summary).toBe("auto");
  });

  it("omits reasoning_effort for none/off and adds no reasoning_summary", () => {
    const out = exec.transformRequest(
      "glm-5.2",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });
});
