/**
 * Unit tests for reasoningContentInjector (issue #1543).
 *
 * DeepSeek V4 thinking mode rejects follow-up requests whose assistant
 * messages omit `reasoning_content` ("The `reasoning_content` in the thinking
 * mode must be passed back to the API."). OpenAI-format clients strip it, so
 * the injector echoes a placeholder back. These tests lock that behavior and
 * guard that the OpenCode executor (which routes deepseek-v4-flash-free)
 * actually runs the injector.
 */

import { describe, it, expect } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const assistantWithToolCall = {
  role: "assistant",
  content: "",
  tool_calls: [{ id: "call_x", type: "function", function: { name: "get_weather", arguments: "{}" } }],
};

function bodyWith(messages) {
  return { model: "deepseek-v4-flash", messages, reasoning_effort: "medium" };
}

describe("injectReasoningContent — DeepSeek thinking round-trip", () => {
  it("injects reasoning_content on a deepseek- assistant message that lacks it", () => {
    const out = injectReasoningContent({
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      body: bodyWith([{ role: "user", content: "hi" }, assistantWithToolCall]),
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(typeof assistant.reasoning_content).toBe("string");
    expect(assistant.reasoning_content.length).toBeGreaterThan(0);
  });

  it("preserves an existing reasoning_content instead of overwriting it", () => {
    const original = "model's real chain of thought";
    const out = injectReasoningContent({
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      body: bodyWith([{ ...assistantWithToolCall, reasoning_content: original }]),
    });
    expect(out.messages[0].reasoning_content).toBe(original);
  });

  it("applies provider-level rule for provider 'deepseek' (scope all)", () => {
    const out = injectReasoningContent({
      provider: "deepseek",
      model: "deepseek-chat",
      body: bodyWith([{ role: "assistant", content: "answer" }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("matches deepseek model id case-insensitively for custom providers (#1543)", () => {
    const out = injectReasoningContent({
      provider: "openai-compatible-custom",
      model: "DeepSeek-V4-Flash",
      body: bodyWith([assistantWithToolCall]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("does not touch non-deepseek providers/models", () => {
    const out = injectReasoningContent({
      provider: "openai",
      model: "gpt-5.5",
      body: bodyWith([{ role: "assistant", content: "answer" }]),
    });
    expect(out.messages[0].reasoning_content).toBeUndefined();
  });

  it("maps deepseek-v4-pro-none alias to disabled thinking and strips reasoning_effort", () => {
    const out = injectReasoningContent({
      provider: "deepseek",
      model: "deepseek-v4-pro-none",
      body: bodyWith([{ role: "user", content: "hi" }]),
    });
    expect(out.model).toBe("deepseek-v4-pro");
    expect(out.extra_body.thinking.type).toBe("disabled");
    expect(out.reasoning_effort).toBeUndefined();
  });
});

describe("injectReasoningContent — MiniMax thinking round-trip", () => {
  const minimaxAssistantMsg = { role: "assistant", content: "here is a response", reasoning_content: "" };
  const minimaxAssistantWithToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_x", type: "function", function: { name: "get_weather", arguments: "{}" } }],
    reasoning_content: "",
  };

  it("injects reasoning_content on a minimax assistant message that lacks it", () => {
    const out = injectReasoningContent({
      provider: "minimax",
      model: "MiniMax-M2.7",
      body: bodyWith([{ role: "user", content: "hi" }, minimaxAssistantMsg]),
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(typeof assistant.reasoning_content).toBe("string");
    expect(assistant.reasoning_content.length).toBeGreaterThan(0);
  });

  it("injects reasoning_content on minimax assistant message with tool_calls but no reasoning_content", () => {
    const out = injectReasoningContent({
      provider: "minimax",
      model: "MiniMax-M2.7",
      body: bodyWith([{ role: "user", content: "hi" }, minimaxAssistantWithToolCall]),
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(typeof assistant.reasoning_content).toBe("string");
    expect(assistant.reasoning_content.length).toBeGreaterThan(0);
  });

  it("applies provider-level rule for provider 'minimax-cn' (scope all)", () => {
    const out = injectReasoningContent({
      provider: "minimax-cn",
      model: "MiniMax-M2.5",
      body: bodyWith([{ role: "assistant", content: "answer" }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("preserves an existing reasoning_content on minimax instead of overwriting", () => {
    const original = "MiniMax chain of thought reasoning";
    const out = injectReasoningContent({
      provider: "minimax",
      model: "MiniMax-M2.7",
      body: bodyWith([{ ...minimaxAssistantMsg, reasoning_content: original }]),
    });
    expect(out.messages[0].reasoning_content).toBe(original);
  });

  it("DefaultExecutor transformRequest runs the injector for minimax", () => {
    const { DefaultExecutor } = require("../../open-sse/executors/default.js");
    const executor = new DefaultExecutor("minimax");
    const out = executor.transformRequest(
      "MiniMax-M2.7",
      bodyWith([{ role: "user", content: "hi" }, minimaxAssistantMsg]),
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(typeof assistant.reasoning_content).toBe("string");
    expect(assistant.reasoning_content.length).toBeGreaterThan(0);
  });
});

describe("OpenCodeExecutor — issue #1543 regression", () => {
  it("runs the injector so deepseek-v4-flash-free round-trips reasoning_content", () => {
    const executor = new OpenCodeExecutor();
    const out = executor.transformRequest(
      "deepseek-v4-flash-free",
      bodyWith([{ role: "user", content: "hi" }, assistantWithToolCall]),
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toBeDefined();
  });
});
