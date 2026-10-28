// OpenAI->Claude must honor an explicit client cap even with tools present:
// a 1-token cache-warm request (max_tokens / max_completion_tokens = 1) used
// to be raised to 32000 (tool floor) or ignored (max_completion_tokens).
// Other paths keep the tool floor.
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../open-sse/config/runtimeConfig.js";

const tools = [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }];
const messages = [{ role: "user", content: "hi" }];
const toClaude = (extra) => openaiToClaudeRequest("claude-sonnet-4.5", { messages, tools, ...extra }, false).max_tokens;

describe("adjustMaxTokens explicit caps", () => {
  it("openai->claude honors max_completion_tokens with tools", () => {
    expect(toClaude({ max_completion_tokens: 1 })).toBe(1);
  });

  it("openai->claude honors max_tokens with tools", () => {
    expect(toClaude({ max_tokens: 1 })).toBe(1);
  });

  it("max_completion_tokens wins over max_tokens", () => {
    expect(toClaude({ max_tokens: 500, max_completion_tokens: 1 })).toBe(1);
  });

  it("no cap still defaults to the ceiling", () => {
    expect(toClaude({})).toBe(DEFAULT_MAX_TOKENS);
  });

  it("thinking budget still forces max_tokens above it", () => {
    expect(toClaude({ max_completion_tokens: 1, thinking: { type: "enabled", budget_tokens: 2048 } })).toBe(2048 + 1024);
  });

  it("claude->openai keeps the tool floor", () => {
    const claudeTools = [{ name: "f", input_schema: { type: "object", properties: {} } }];
    const out = claudeToOpenAIRequest("gpt-x", { messages, tools: claudeTools, max_tokens: 4096 }, false);
    expect(out.max_tokens).toBe(DEFAULT_MIN_TOKENS);
  });
});
