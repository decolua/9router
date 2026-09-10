/**
 * Unit tests for the Claude passthrough tool-name decloaking used by stream.js.
 * The helper is tested directly so this focused test does not load the whole
 * Next.js-only stream dependency graph.
 */

import { describe, it, expect } from "vitest";
import { decloakClaudeToolUseEvent } from "../../open-sse/utils/streamHelpers.js";

function toolUse(name = "Execute_ide") {
  return {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_01", name, input: {} }
  };
}

describe("claude→claude passthrough tool-name decloaking", () => {
  it("decloaks a mapped tool_use name", () => {
    const event = toolUse();
    expect(decloakClaudeToolUseEvent(event, new Map([["Execute_ide", "Execute"]]))).toBe(true);
    expect(event.content_block.name).toBe("Execute");
  });

  it("leaves non-tool_use events untouched", () => {
    const event = { type: "content_block_start", content_block: { type: "text", text: "" } };
    expect(decloakClaudeToolUseEvent(event, new Map([["Execute_ide", "Execute"]]))).toBe(false);
    expect(event.content_block).toEqual({ type: "text", text: "" });
  });

  it("is a no-op without a tool-name map", () => {
    const event = toolUse("Execute");
    expect(decloakClaudeToolUseEvent(event, null)).toBe(false);
    expect(event.content_block.name).toBe("Execute");
  });

  it("does not decloak a name missing from the map", () => {
    const event = toolUse();
    expect(decloakClaudeToolUseEvent(event, new Map([["Other_ide", "Other"]]))).toBe(false);
    expect(event.content_block.name).toBe("Execute_ide");
  });
});
