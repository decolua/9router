/**
 * Unit tests for open-sse/utils/claudeCloaking.js
 *
 * Tests cover:
 *  - cloakClaudeTools() - tool renaming and forced tool_choice suffixing
 *  - decloakStreamChunk() - restoring tool names in streamed Claude SSE events
 */

import { describe, it, expect } from "vitest";
import { applyCloaking, cloakClaudeTools, decloakStreamChunk } from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

it("advertises a Claude Code version accepted by Fable 5.1", () => {
  const body = applyCloaking({ messages: [] }, "sk-ant-oat-test", "session-id");
  expect(body.system[0].text).toMatch(/^x-anthropic-billing-header: cc_version=2.1.280\./);
});

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

  describe("tool_reference blocks", () => {
    const withReferences = (content) => ({
      tools: [
        { name: "ToolSearch", input_schema: { type: "object", properties: {} } },
        { name: "Monitor", defer_loading: true, input_schema: { type: "object", properties: {} } }
      ],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "ToolSearch", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content }] }
      ]
    });
    const cloakedResult = (input) => cloakClaudeTools(input).body.messages[1].content[0];

    it("renames references to match the suffixed tool declaration", () => {
      const input = withReferences([{ type: "tool_reference", tool_name: "Monitor" }]);
      const { body } = cloakClaudeTools(input);
      const [reference] = body.messages[1].content[0].content;
      // Without this, Claude rejects: "Tool reference 'Monitor' not found in available tools".
      expect(reference).toEqual({ type: "tool_reference", tool_name: `Monitor${CLAUDE_TOOL_SUFFIX}` });
      expect(body.tools.some(t => t.name === reference.tool_name)).toBe(true);
    });

    it("leaves references to names it did not rename unchanged", () => {
      const reference = { type: "tool_reference", tool_name: "Bash" };
      expect(cloakedResult(withReferences([reference])).content).toEqual([reference]);
    });

    it("keeps sibling content and string tool_result content intact", () => {
      const text = { type: "text", text: "Monitor" };
      expect(cloakedResult(withReferences([text])).content).toEqual([text]);
      expect(cloakedResult(withReferences("Monitor")).content).toBe("Monitor");
    });

    it("does not mutate the client's request", () => {
      const input = withReferences([{ type: "tool_reference", tool_name: "Monitor" }]);
      cloakClaudeTools(input);
      expect(input.messages[1].content[0].content[0].tool_name).toBe("Monitor");
    });
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

describe("decloakStreamChunk", () => {
  // Cloaked exactly as cloakClaudeTools() does on the request side
  const toolNameMap = new Map([["run_code" + CLAUDE_TOOL_SUFFIX, "run_code"]]);

  const toolUseStart = (name) => ({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_01abc", name, input: {} }
  });

  it("restores the original name on a tool_use content_block_start", () => {
    const out = decloakStreamChunk(toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX), toolNameMap);
    expect(out.content_block.name).toBe("run_code");
  });

  it("does not mutate the input chunk", () => {
    const chunk = toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX);
    decloakStreamChunk(chunk, toolNameMap);
    expect(chunk.content_block.name).toBe("run_code" + CLAUDE_TOOL_SUFFIX);
  });

  it("passes through names the map does not know (e.g. decoy tools)", () => {
    const chunk = toolUseStart("Bash");
    expect(decloakStreamChunk(chunk, toolNameMap)).toBe(chunk);
  });

  it("passes through non-tool_use events unchanged", () => {
    const textStart = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    expect(decloakStreamChunk(textStart, toolNameMap)).toBe(textStart);

    const delta = { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } };
    expect(decloakStreamChunk(delta, toolNameMap)).toBe(delta);
  });

  it("tolerates null chunks and missing maps (stream flush path)", () => {
    expect(decloakStreamChunk(null, toolNameMap)).toBeNull();
    expect(decloakStreamChunk(toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX), null).content_block.name).toBe("run_code");
    expect(decloakStreamChunk(toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX), new Map()).content_block.name).toBe("run_code");
    expect(decloakStreamChunk(toolUseStart("uncloaked_tool"), null).content_block.name).toBe("uncloaked_tool");
  });
});
