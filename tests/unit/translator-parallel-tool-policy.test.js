import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const messages = [{ role: "user", content: "hello" }];
const openaiTools = [{ type: "function", function: { name: "probe", parameters: { type: "object", properties: {} } } }];
const claudeTools = [{ name: "probe", input_schema: { type: "object", properties: {} } }];

describe("single-tool-call policy translation", () => {
  it.each(["auto", "required"])('preserves OpenAI parallel_tool_calls:false with tool_choice:%s', (tool_choice) => {
    const result = openaiToClaudeRequest("claude-sonnet-4-6", { messages, tools: openaiTools, tool_choice, parallel_tool_calls: false }, false);
    expect(result.tool_choice).toMatchObject({ type: tool_choice === "required" ? "any" : "auto", disable_parallel_tool_use: true });
  });

  it("adds an auto tool choice for an implicit OpenAI choice", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4-6", { messages, tools: openaiTools, parallel_tool_calls: false }, false);
    expect(result.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("maps Claude's parallel restriction to OpenAI", () => {
    const result = claudeToOpenAIRequest("gpt-5.5", { messages, tools: claudeTools, tool_choice: { type: "any", disable_parallel_tool_use: true } }, false);
    expect(result.tool_choice).toBe("required");
    expect(result.parallel_tool_calls).toBe(false);
  });

  it("does not add a restriction when none was requested", () => {
    const result = claudeToOpenAIRequest("gpt-5.5", { messages, tools: claudeTools, tool_choice: { type: "auto" } }, false);
    expect(result.parallel_tool_calls).toBeUndefined();
  });
});
