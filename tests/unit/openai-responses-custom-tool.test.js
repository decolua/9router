/**
 * Tests for Codex custom/freeform tool translation in openai-responses.js
 *
 * Codex Responses API sends apply_patch as a "custom" tool with a grammar-based
 * format instead of a JSON schema. Without special handling, 9router was converting
 * this to an empty function schema, causing downstream models to call apply_patch
 * with {} instead of { input: "<patch string>" }.
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
