import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/helpers/claudeHelper.js";

describe("prepareClaudeRequest context_management compatibility", () => {
  it("strips Claude Code context_management for anthropic-compatible providers", () => {
    const body = {
      model: "claude-compatible",
      max_tokens: 100,
      context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    };

    const result = prepareClaudeRequest(body, "anthropic-compatible-custom");

    expect(result.context_management).toBeUndefined();
    expect(result.messages[0].content[0].text).toBe("hi");
  });

  it("keeps context_management for the first-party Claude provider", () => {
    const body = {
      model: "claude-sonnet",
      max_tokens: 100,
      context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    };

    const result = prepareClaudeRequest(body, "claude");

    expect(result.context_management).toEqual({ edits: [{ type: "clear_tool_uses_20250919" }] });
  });
});
