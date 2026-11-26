// Regression tests for #5170: cloaking must be idempotent across turns.
import { describe, it, expect } from "vitest";
import {
  cloakClaudeTools,
  decloakStreamChunk,
  decloakToolNames,
} from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const suffix = (name) => `${name}${CLAUDE_TOOL_SUFFIX}`;

const bodyWithTool = (toolName) => ({
  tools: [{ name: toolName, input_schema: { type: "object", properties: {} } }],
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
});

describe("cloakClaudeTools is idempotent", () => {
  it("does not re-suffix a tool_use name that is already cloaked", () => {
    const { body } = cloakClaudeTools({
      ...bodyWithTool("read"),
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: suffix("read"), input: {} }],
        },
      ],
    });
    expect(body.messages[0].content[0].name).toBe(suffix("read"));
  });

  it("collapses an older multi-suffix name back to a single suffix", () => {
    const { body } = cloakClaudeTools({
      ...bodyWithTool("bash"),
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: suffix(suffix("bash")), input: {} },
          ],
        },
      ],
    });
    expect(body.messages[0].content[0].name).toBe(suffix("bash"));
  });

  it("does not re-suffix an already-cloaked tool_reference", () => {
    const { body } = cloakClaudeTools({
      ...bodyWithTool("Monitor"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "tool_reference", tool_name: suffix("Monitor") }],
            },
          ],
        },
      ],
    });
    expect(body.messages[0].content[0].content[0].tool_name).toBe(suffix("Monitor"));
  });

  it("does not re-suffix an already-cloaked forced tool_choice", () => {
    const { body } = cloakClaudeTools({
      ...bodyWithTool("read"),
      tool_choice: { type: "tool", name: suffix("read") },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: suffix("read") });
  });

  it("still restores the original name for a normalized history entry", () => {
    const { body, toolNameMap } = cloakClaudeTools({
      ...bodyWithTool("read"),
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: suffix(suffix("read")), input: {} }],
        },
      ],
    });
    const decloaked = decloakToolNames({ content: body.messages[0].content }, toolNameMap);
    expect(decloaked.content[0].name).toBe("read");
  });
});

describe("cloaking fallback strips all stacked suffixes", () => {
  const toolUseStart = (name) => ({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "t1", name, input: {} },
  });

  it("restores a multi-suffix name when the map is missing (non-streaming)", () => {
    const body = { content: [toolUseStart(suffix(suffix("bash"))).content_block] };
    expect(decloakToolNames(body, null).content[0].name).toBe("bash");
  });

  it("restores a multi-suffix name when the map is missing (streaming)", () => {
    const chunk = toolUseStart(suffix(suffix("bash")));
    expect(decloakStreamChunk(chunk, null).content_block.name).toBe("bash");
  });

  it("leaves a decoy-derived name alone", () => {
    const body = { content: [{ type: "tool_use", id: "t1", name: suffix("Bash"), input: {} }] };
    expect(decloakToolNames(body, null).content[0].name).toBe(suffix("Bash"));
  });
});
