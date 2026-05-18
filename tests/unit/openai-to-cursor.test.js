import { describe, it, expect } from "vitest";
import { buildCursorRequest } from "../../open-sse/translator/request/openai-to-cursor.js";

describe("openai-to-cursor native dynamic tool calling", () => {
  it("preserves explicit tool_choice object as-is", () => {
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "use context7" }],
      tools: [{ type: "function", function: { name: "mcp__context7__query-docs" } }],
      tool_choice: { type: "function", function: { name: "mcp__context7__resolve-library-id" } },
    }, true, null);

    expect(req.tool_choice).toEqual({
      type: "function",
      function: { name: "mcp__context7__resolve-library-id" },
    });
  });

  it("preserves explicit tool_choice string forms (auto/none/required)", () => {
    for (const choice of ["auto", "none", "required"]) {
      const req = buildCursorRequest("default", {
        messages: [{ role: "user", content: "anything" }],
        tools: [{ type: "function", function: { name: "mcp__github__create_issue" } }],
        tool_choice: choice,
      }, true, null);
      expect(req.tool_choice).toBe(choice);
    }
  });

  it("does not infer tool_choice from user message keywords", () => {
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "please use context7 to search svelte docs" }],
      tools: [{ type: "function", function: { name: "mcp__context7__query-docs" } }],
    }, true, null);

    expect(req.tool_choice).toBeUndefined();
  });

  it("does not infer tool_choice even when message names a tool", () => {
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "use tool github to create an issue for the crash bug" }],
      tools: [
        { type: "function", function: { name: "mcp__github__create_issue", description: "Create a GitHub issue" } },
        { type: "function", function: { name: "mcp__context7__query-docs", description: "Search docs" } },
      ],
    }, true, null);

    expect(req.tool_choice).toBeUndefined();
  });

  it("preserves the original tools list order (no reordering)", () => {
    const tools = [
      { type: "function", function: { name: "mcp__context7__query-docs", description: "Search docs" } },
      { type: "function", function: { name: "mcp__github__create_issue", description: "Create a GitHub issue" } },
      { type: "function", function: { name: "mcp__svelte__get-documentation", description: "Svelte docs" } },
    ];
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "please create github issue for crash bug" }],
      tools,
    }, true, null);

    expect(req.tools.map(t => t.function.name)).toEqual([
      "mcp__context7__query-docs",
      "mcp__github__create_issue",
      "mcp__svelte__get-documentation",
    ]);
  });

  it("passes through arbitrary dynamic MCP tool names unchanged", () => {
    const tools = [
      { type: "function", function: { name: "mcp__newserver__some_tool", description: "Anything" } },
      { type: "function", function: { name: "mcp__plugin_xyz_abc__do-thing", description: "Plugin tool" } },
    ];
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "do something" }],
      tools,
    }, true, null);

    expect(req.tools).toEqual(tools);
    expect(req.tool_choice).toBeUndefined();
  });

  it("emits no tools field when tools are not provided", () => {
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "hello" }],
    }, true, null);

    expect(req.tools).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
  });

  it("strips OpenAI/Anthropic-only fields and forces max_tokens", () => {
    const req = buildCursorRequest("default", {
      messages: [{ role: "user", content: "hi" }],
      user: "u-1",
      metadata: { foo: "bar" },
      stream_options: { include_usage: true },
      system: "ignored",
      max_tokens: 100,
    }, true, null);

    expect(req.user).toBeUndefined();
    expect(req.metadata).toBeUndefined();
    expect(req.stream_options).toBeUndefined();
    expect(req.system).toBeUndefined();
    expect(req.max_tokens).toBe(32000);
  });
});
