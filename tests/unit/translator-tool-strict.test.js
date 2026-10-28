import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("tool strict translation", () => {
  it.each([true, false, undefined])("preserves OpenAI strict:%s on Claude tools", (strict) => {
    const functionTool = { name: "probe", parameters: { type: "object", properties: {} } };
    if (strict !== undefined) functionTool.strict = strict;
    const result = openaiToClaudeRequest("claude-sonnet-4-6", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: functionTool }],
    }, false);
    expect(result.tools[0].strict).toBe(strict);
    if (strict === undefined) expect(result.tools[0]).not.toHaveProperty("strict");
  });

  it.each([true, false, undefined])("preserves Claude strict:%s on OpenAI tools", (strict) => {
    const tool = { name: "probe", input_schema: { type: "object", properties: {} } };
    if (strict !== undefined) tool.strict = strict;
    const result = claudeToOpenAIRequest("gpt-5.5", {
      messages: [{ role: "user", content: "hi" }], tools: [tool],
    }, false);
    expect(result.tools[0].function.strict).toBe(strict);
    if (strict === undefined) expect(result.tools[0].function).not.toHaveProperty("strict");
  });
});
