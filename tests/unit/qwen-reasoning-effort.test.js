import { describe, it, expect } from "vitest";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";

const qwenExecutor = new QwenExecutor();

describe("Qwen reasoning_effort + tool_choice neutralization", () => {
  it("neutralizes tool_choice:required when reasoning_effort is set", () => {
    const body = {
      messages: [{ role: "user", content: "What is 2+2?" }],
      reasoning_effort: "high",
      tool_choice: "required",
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("auto");
  });

  it("neutralizes tool_choice object when reasoning_effort is set", () => {
    const body = {
      messages: [{ role: "user", content: "What is 2+2?" }],
      reasoning_effort: "low",
      tool_choice: { type: "function", function: { name: "some_tool" } },
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("auto");
  });

  it("neutralizes tool_choice when thinking.type is enabled", () => {
    const body = {
      messages: [{ role: "user", content: "test" }],
      thinking: { type: "enabled", budget_tokens: 16384 },
      tool_choice: "required",
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("auto");
  });

  it("neutralizes tool_choice when enable_thinking is set", () => {
    const body = {
      messages: [{ role: "user", content: "test" }],
      enable_thinking: true,
      tool_choice: { type: "auto" },
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("auto");
  });

  it("preserves tool_choice when no thinking mode is set", () => {
    const body = {
      messages: [{ role: "user", content: "What is 2+2?" }],
      tool_choice: "required",
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("required");
  });

  it("preserves tool_choice object when no thinking mode is set", () => {
    const body = {
      messages: [{ role: "user", content: "test" }],
      tool_choice: { type: "function", function: { name: "some_tool" } },
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toEqual({ type: "function", function: { name: "some_tool" } });
  });

  it("does not neutralize tool_choice: auto when thinking is set", () => {
    const body = {
      messages: [{ role: "user", content: "test" }],
      reasoning_effort: "medium",
      tool_choice: "auto",
      stream: true
    };

    const result = qwenExecutor.transformRequest("coder-model", body, true, { apiKey: "test" });
    expect(result.tool_choice).toBe("auto");
  });
});
