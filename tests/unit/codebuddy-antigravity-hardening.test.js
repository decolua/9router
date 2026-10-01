// Regression: second-pass hardening for CodeBuddy CN + Antigravity.
import { describe, expect, it } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { sanitiseSystemMessage, NEUTRAL_PROMPT } from "../../open-sse/executors/codebuddySanitise.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import { detectContextOverflow } from "../../open-sse/handlers/chatCore.js";

describe("CodeBuddy CN leading-system-message guarantee", () => {
  const exec = new CodeBuddyExecutor();

  it("injects a neutral system message when the caller sent none", () => {
    const out = exec.transformRequest("glm-5.3", { messages: [{ role: "user", content: "hi" }] }, false, {});
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toBe(NEUTRAL_PROMPT);
  });

  it("drops developer messages (gateway rejects the role)", () => {
    const out = exec.transformRequest("glm-5.3", { messages: [{ role: "developer", content: "d" }, { role: "user", content: "hi" }] }, false, {});
    expect(out.messages.some((m) => m.role === "developer")).toBe(false);
    expect(out.messages[0].role).toBe("system");
  });
});

describe("AGENT_PATTERN does not over-match benign prompts", () => {
  it("leaves a benign 'you are an AI agent' system prompt alone", () => {
    const benign = { role: "system", content: "You are an AI agent that summarizes documents." };
    expect(sanitiseSystemMessage(benign).content).toBe(benign.content);
  });

  it("still replaces a genuine CLI identity prompt", () => {
    expect(sanitiseSystemMessage({ role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." }).content).toBe(NEUTRAL_PROMPT);
  });
});

describe("Antigravity response tool-call emission is idempotent", () => {
  it("does not re-emit accumulated tool calls on a repeated finish chunk", () => {
    const state = { _toolCallAccum: { 0: { id: "c", name: "Read", arguments: '{"p":1}' } } };
    const first = openaiToAntigravityResponse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state);
    const firstCalls = JSON.stringify(first).match(/functionCall/g)?.length || 0;
    // A duplicated finish chunk must not re-emit.
    const second = openaiToAntigravityResponse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state);
    const secondCalls = JSON.stringify(second || []).match(/functionCall/g)?.length || 0;
    expect(firstCalls).toBeGreaterThan(0);
    expect(secondCalls).toBe(0);
  });
});

describe("detectContextOverflow wordings", () => {
  it("flags Anthropic and generic overflow wordings", () => {
    expect(detectContextOverflow(400, "prompt is too long", "codebuddy-intl", "glm-5.3")).toBeTruthy();
    expect(detectContextOverflow(400, "This model's maximum context length is 128000 tokens", "codebuddy-intl", "glm-5.3")).toBeTruthy();
    expect(detectContextOverflow(413, "", "codebuddy-intl", "glm-5.3")).toBeTruthy(); // 413 by status
  });

  it("does not flag an unrelated 400", () => {
    expect(detectContextOverflow(400, "invalid api key", "codebuddy-intl", "glm-5.3")).toBeNull();
  });
});
