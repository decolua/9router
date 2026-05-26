/**
 * Tests for Codex custom/freeform tool translation in openai-responses.js
 *
 * Codex Responses API sends apply_patch as a "custom" tool with a grammar-based
 * format instead of a JSON schema. Without special handling, 9router was converting
 * this to an empty function schema, causing downstream models to call apply_patch
 * with {} instead of { input: "<patch string>" }.
 *
 * Also covers custom_tool_call / custom_tool_call_output history items that Codex
 * sends in subsequent turns — these must be translated so the downstream model
 * receives the tool result and does not loop.
 */

import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

const APPLY_PATCH_TOOL = {
  type: "custom",
  name: "apply_patch",
  description: "Apply a patch to the codebase. FREEFORM tool.",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: "start: PATCH_HEADER ...",
  },
};

describe("openaiResponsesToOpenAIRequest — apply_patch custom tool", () => {
  function makeBody(tools) {
    return {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "fix bug" }] }],
      tools,
    };
  }

  it("converts apply_patch custom tool to function tool with { input: string } schema", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", makeBody([APPLY_PATCH_TOOL]), true, null);

    expect(result.tools).toHaveLength(1);
    const tool = result.tools[0];
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("apply_patch");

    const params = tool.function.parameters;
    expect(params.type).toBe("object");
    expect(params.properties.input.type).toBe("string");
    expect(params.required).toContain("input");
    expect(params.additionalProperties).toBe(false);
  });

  it("does not produce an empty parameters schema for apply_patch", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", makeBody([APPLY_PATCH_TOOL]), true, null);

    const params = result.tools[0].function.parameters;
    expect(Object.keys(params.properties).length).toBeGreaterThan(0);
  });

  it("preserves apply_patch description", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", makeBody([APPLY_PATCH_TOOL]), true, null);

    expect(result.tools[0].function.description).toBe(APPLY_PATCH_TOOL.description);
  });

  it("handles any custom tool (not just apply_patch) with the same { input: string } normalization", () => {
    const customTool = {
      type: "custom",
      name: "run_shell",
      description: "Run a shell command",
      format: { type: "grammar", syntax: "lark", definition: "..." },
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", makeBody([customTool]), true, null);

    const tool = result.tools[0];
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("run_shell");
    expect(tool.function.parameters.properties.input.type).toBe("string");
    expect(tool.function.parameters.required).toContain("input");
  });

  it("still converts normal function tools correctly alongside custom tools", () => {
    const normalTool = {
      type: "function",
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    };
    const result = openaiResponsesToOpenAIRequest(
      "gpt-4o",
      makeBody([APPLY_PATCH_TOOL, normalTool]),
      true,
      null,
    );

    expect(result.tools).toHaveLength(2);

    const patch = result.tools.find(t => t.function.name === "apply_patch");
    expect(patch.function.parameters.properties.input).toBeDefined();
    expect(patch.function.parameters.required).toContain("input");

    const read = result.tools.find(t => t.function.name === "read_file");
    expect(read.function.parameters.properties.path).toBeDefined();
    expect(read.function.parameters.required).toContain("path");
  });

  it("skips custom tools with missing or empty name", () => {
    const namelessTool = {
      type: "custom",
      name: "",
      description: "nameless",
      format: { type: "grammar", syntax: "lark", definition: "..." },
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", makeBody([namelessTool]), true, null);

    expect(result.tools).toHaveLength(0);
  });
});

describe("openaiResponsesToOpenAIRequest — custom_tool_call / custom_tool_call_output history", () => {
  const PATCH_TEXT = "*** Begin Patch\n*** Add File: foo.txt\n+hello\n*** End Patch";

  it("translates custom_tool_call to assistant message with tool_calls, wrapping input as {input:string}", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "patch it" }] },
        { type: "custom_tool_call", call_id: "call_1", name: "apply_patch", input: PATCH_TEXT },
      ],
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", body, true, null);

    const asst = result.messages.find((m) => m.role === "assistant");
    expect(asst).toBeDefined();
    expect(asst.tool_calls).toHaveLength(1);
    expect(asst.tool_calls[0].id).toBe("call_1");
    expect(asst.tool_calls[0].function.name).toBe("apply_patch");
    const args = JSON.parse(asst.tool_calls[0].function.arguments);
    expect(args.input).toBe(PATCH_TEXT);
  });

  it("translates custom_tool_call_output to tool message, unwrapping JSON-wrapped output", () => {
    const successOutput = JSON.stringify({
      output: "Success. Updated the following files:\nA foo.txt\n",
      metadata: { exit_code: 0, duration_seconds: 0.1 },
    });
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "patch it" }] },
        { type: "custom_tool_call", call_id: "call_1", name: "apply_patch", input: PATCH_TEXT },
        { type: "custom_tool_call_output", call_id: "call_1", output: successOutput },
      ],
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", body, true, null);

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("call_1");
    // JSON-wrapped output should be unwrapped to plain string
    expect(toolMsg.content).toBe("Success. Updated the following files:\nA foo.txt\n");
  });

  it("passes plain-string error output as-is (no JSON wrapping)", () => {
    const errorOutput = "apply_patch verification failed: file not found (os error 2)";
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "patch" }] },
        { type: "custom_tool_call", call_id: "call_2", name: "apply_patch", input: PATCH_TEXT },
        { type: "custom_tool_call_output", call_id: "call_2", output: errorOutput },
      ],
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", body, true, null);

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe(errorOutput);
  });

  it("produces correct message sequence: user → assistant(tool_calls) → tool", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
        { type: "custom_tool_call", call_id: "call_3", name: "apply_patch", input: PATCH_TEXT },
        { type: "custom_tool_call_output", call_id: "call_3", output: JSON.stringify({ output: "Success", metadata: { exit_code: 0 } }) },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", body, true, null);

    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "user"]);
  });
});
