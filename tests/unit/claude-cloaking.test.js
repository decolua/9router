/**
 * Unit tests for open-sse/utils/claudeCloaking.js
 *
 * Tests cover:
 *  - cloakClaudeTools() - tool renaming and forced tool_choice suffixing
 */

import { describe, it, expect } from "vitest";
import { cloakClaudeTools } from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

describe("cloakClaudeTools", () => {
  const baseBody = {
    tools: [{ name: "todo_write", description: "write todos", input_schema: { type: "object", properties: {} } }],
    messages: [{ role: "user", content: [{ type: "text", text: "add a todo" }] }]
  };

  it("suffixes client tool names and maps them back", () => {
    const { body, toolNameMap } = cloakClaudeTools(baseBody);
    const suffixed = `todo_write${CLAUDE_TOOL_SUFFIX}`;
    expect(body.tools.find(t => t.name === suffixed)).toBeDefined();
    expect(toolNameMap.get(suffixed)).toBe("todo_write");
  });

  it("suffixes a forced tool_choice to match the renamed tool", () => {
    const { body } = cloakClaudeTools({
      ...baseBody,
      tool_choice: { type: "tool", name: "todo_write" }
    });
    // Without this, Claude rejects: "Tool 'todo_write' not found in provided tools".
    expect(body.tool_choice).toEqual({ type: "tool", name: `todo_write${CLAUDE_TOOL_SUFFIX}` });
  });

  it("suffixes only the chosen tool when several are present", () => {
    const { body } = cloakClaudeTools({
      tools: [
        { name: "search", input_schema: { type: "object", properties: {} } },
        { name: "todo_write", input_schema: { type: "object", properties: {} } }
      ],
      tool_choice: { type: "tool", name: "todo_write" }
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: `todo_write${CLAUDE_TOOL_SUFFIX}` });
  });

  it("leaves non-forced tool_choice untouched", () => {
    const auto = cloakClaudeTools({ ...baseBody, tool_choice: { type: "auto" } });
    expect(auto.body.tool_choice).toEqual({ type: "auto" });

    const none = cloakClaudeTools({ ...baseBody });
    expect(none.body.tool_choice).toBeUndefined();
  });

  it("does not suffix a forced choice that targets a non-client (decoy/built-in) tool", () => {
    // "Bash" is an injected decoy sent unsuffixed; forcing it must stay as-is.
    const { body } = cloakClaudeTools({ ...baseBody, tool_choice: { type: "tool", name: "Bash" } });
    expect(body.tool_choice).toEqual({ type: "tool", name: "Bash" });
  });

  it("renames tool_use names in message history", () => {
    const { body } = cloakClaudeTools({
      ...baseBody,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "todo_write", input: {} }] }
      ]
    });
    const block = body.messages[0].content[0];
    expect(block.name).toBe(`todo_write${CLAUDE_TOOL_SUFFIX}`);
  });

  it("returns the body unchanged when there are no tools", () => {
    const input = { messages: [{ role: "user", content: "hi" }], tool_choice: { type: "tool", name: "x" } };
    const { body, toolNameMap } = cloakClaudeTools(input);
    expect(body).toBe(input);
    expect(toolNameMap).toBeNull();
  });
});
