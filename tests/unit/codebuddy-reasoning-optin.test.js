// #2071 — CodeBuddy forced reasoning_effort:"medium" + reasoning_summary:"auto"
// on requests where the client never asked for reasoning, tripping CodeBuddy's
// content filter ("model return error"). Reasoning params must be opt-in.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyExecutor reasoning params are opt-in (#2071)", () => {
  const exec = new CodeBuddyExecutor();
  const intlExec = new CodeBuddyIntlExecutor();

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

  it("normalizes developer role to system, max_completion_tokens to max_tokens, and neutralizes ZCode/DSH/Codex agent prompts", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        max_completion_tokens: 4096,
        messages: [
          { role: "developer", content: "You are ZCode, an interactive coding agent." },
          { role: "system", content: "You are an AI agent powered by DeepSeek Harness." },
          { role: "user", content: "hello" },
        ],
      },
      false,
      {}
    );
    expect(out.max_tokens).toBe(4096);
    expect(out.max_completion_tokens).toBeUndefined();
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).not.toContain("ZCode");
    expect(out.messages[1].content).not.toContain("DeepSeek Harness");
  });

  it("preserves caller system/developer prompts on codebuddy-intl and converts reasoning_content to reasoning", () => {
    const out = intlExec.transformRequest(
      "deepseek-v4.1-flash",
      {
        max_completion_tokens: 1024,
        messages: [
          { role: "developer", content: "The secret project codeword is PINEAPPLE-77." },
          { role: "user", content: "What is the codeword?" },
          { role: "assistant", content: "PINEAPPLE-77", reasoning_content: "Recalling the system instruction." },
        ],
      },
      false,
      {}
    );
    expect(out.max_tokens).toBe(1024);
    expect(out.messages[0]).toEqual({ role: "system", content: "The secret project codeword is PINEAPPLE-77." });
    expect(out.messages[1].content).toEqual([{ type: "text", text: "What is the codeword?" }]);
    expect(out.messages[2].reasoning).toBe("Recalling the system instruction.");
    expect(out.messages[2].reasoning_content).toBeUndefined();
  });
});
