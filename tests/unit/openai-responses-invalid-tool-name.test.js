import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { describe, it, expect } from "vitest";
import {
  openaiToOpenAIResponsesRequest,
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import { restoreToolNames, takeRenamedToolNames } from "../../open-sse/utils/opencodeFingerprint.js";

const OPENAI_TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

describe("OpenAI Responses tool name sanitization", () => {
  it("sanitizes dot-containing function_call names in existing body.input history", () => {
    const body = {
      model: "gpt-6-luna",
      input: [
        {
          type: "function_call",
          id: "fc_call_pTYBoxTw62azzjt8zCFLvn7f",
          name: "mcp__codex_app.get_worktree_creation_status",
          arguments: "{}",
          call_id: "call_pTYBoxTw62azzjt8zCFLvn7f",
        },
        {
          type: "function_call_output",
          call_id: "call_pTYBoxTw62azzjt8zCFLvn7f",
          output: "unsupported call",
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "continue" }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "mcp__codex_app__get_worktree_creation_status",
          description: "Check creation status",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true, null);
    const fc = out.input.find((item) => item.type === "function_call");
    expect(fc).toBeDefined();
    expect(fc.name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(fc.name).toBe("mcp__codex_app_get_worktree_creation_status");
  });

  it("sanitizes dot-containing tool_calls when converting messages to input", () => {
    const body = {
      model: "gpt-6-luna",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "mcp__codex_app.get_worktree_creation_status",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "result",
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true, null);
    const fc = out.input.find((item) => item.type === "function_call");
    expect(fc).toBeDefined();
    expect(fc.name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(fc.name).toBe("mcp__codex_app_get_worktree_creation_status");
  });

  it("sanitizes dot-containing tool declarations and populates _toolNameMap for restoration", () => {
    const body = {
      model: "gpt-6-luna",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: {
            name: "mcp__node_repl.js",
            description: "Execute js",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    };

    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true, null);
    expect(out.tools[0].name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(out.tools[0].name).toBe("mcp__node_repl_js");
    expect(out._toolNameMap?.get("mcp__node_repl_js")).toBe("mcp__node_repl.js");

    // Restoring upstream tool call mapping
    const restored = restoreToolNames(
      { output: [{ type: "function_call", name: "mcp__node_repl_js" }] },
      out._toolNameMap
    );
    expect(restored.output[0].name).toBe("mcp__node_repl.js");
  });

  it("keeps already-Responses declarations and history distinct after sanitization", () => {
    const body = {
      input: [
        { type: "function_call", call_id: "call_dot", name: "foo.bar", arguments: "{}" },
        { type: "function_call_output", call_id: "call_dot", output: "ok" },
        { type: "custom_tool_call", call_id: "call_slash", name: "foo/bar", input: "run" },
        { type: "custom_tool_call_output", call_id: "call_slash", output: "ok" },
      ],
      tools: [
        { type: "function", name: "foo_bar", parameters: { type: "object", properties: {} } },
        { type: "function", name: "foo.bar", parameters: { type: "object", properties: {} } },
        { type: "custom", name: "foo/bar", format: { type: "text" } },
      ],
      tool_choice: { type: "function", name: "foo.bar" },
    };

    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true, null);
    expect(out.tools.map((tool) => tool.name)).toEqual(["foo_bar", "foo_bar_2", "foo_bar_3"]);
    expect(out.input.filter((item) => item.type === "function_call" || item.type === "custom_tool_call")
      .map((item) => item.name)).toEqual(["foo_bar_2", "foo_bar_3"]);
    expect(out.tool_choice).toEqual({ type: "function", name: "foo_bar_2" });
    expect(out._toolNameMap.get("foo_bar_2")).toBe("foo.bar");
    expect(out._toolNameMap.get("foo_bar_3")).toBe("foo/bar");
  });

  it("limits already-Responses tool and history names to 128 characters", () => {
    const longName = "x".repeat(140);
    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", {
      input: [{ type: "function_call", call_id: "call_long", name: longName, arguments: "{}" }],
      tools: [{ type: "function", name: longName, parameters: { type: "object", properties: {} } }],
      tool_choice: { type: "function", name: longName },
    }, true, null);

    expect(out.tools[0].name).toHaveLength(128);
    expect(out.input[0].name).toBe(out.tools[0].name);
    expect(out.tool_choice.name).toBe(out.tools[0].name);
    expect(out._toolNameMap.get(out.tools[0].name)).toBe(longName);
  });

  it("keeps Chat tool declarations, call history, and choice on the same Responses aliases", () => {
    const declaration = (name) => ({
      type: "function",
      function: { name, parameters: { type: "object", properties: {} } },
    });
    const body = {
      messages: [{
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_dot", type: "function", function: { name: "foo.bar", arguments: "{}" } },
          { id: "call_slash", type: "function", function: { name: "foo/bar", arguments: "{}" } },
        ],
      }],
      tools: [declaration("foo_bar"), declaration("foo.bar"), declaration("foo/bar")],
      tool_choice: { type: "function", function: { name: "foo.bar" } },
    };

    const out = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true, null);
    expect(out.tools.map((tool) => tool.name)).toEqual(["foo_bar", "foo_bar_2", "foo_bar_3"]);
    expect(out.input.filter((item) => item.type === "function_call").map((item) => item.name))
      .toEqual(["foo_bar_2", "foo_bar_3"]);
    expect(out.tool_choice).toEqual({ type: "function", name: "foo_bar_2" });
    expect(out._toolNameMap.get("foo_bar_2")).toBe("foo.bar");
    expect(out._toolNameMap.get("foo_bar_3")).toBe("foo/bar");
  });

  it("does not introduce dots when expanding namespaced tools in openaiResponsesToOpenAIRequest", () => {
    const body = {
      input: "Run status check",
      tools: [
        {
          type: "namespace",
          name: "mcp__codex_app",
          tools: [
            {
              type: "function",
              name: "get_worktree_creation_status",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      ],
    };

    const out = openaiResponsesToOpenAIRequest("gpt-6-luna", body, true, null);
    expect(out.tools[0].function.name).toBe("mcp__codex_app__get_worktree_creation_status");
    expect(out.tools[0].function.name).toMatch(OPENAI_TOOL_NAME_REGEX);
    // Should NOT map back to a dotted name
    if (out._toolNameMap) {
      for (const [alias, original] of out._toolNameMap) {
        expect(alias).toMatch(OPENAI_TOOL_NAME_REGEX);
        expect(original).toMatch(OPENAI_TOOL_NAME_REGEX);
      }
    }
  });

  it("rewrites legacy dot-separated tool names in history during openaiResponsesToOpenAIRequest", () => {
    const body = {
      input: [
        {
          type: "function_call",
          call_id: "call_old",
          name: "mcp__codex_app.get_worktree_creation_status",
          arguments: "{}",
        },
        {
          type: "function_call_output",
          call_id: "call_old",
          output: "ok",
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "next" }],
        },
      ],
      tools: [
        {
          type: "namespace",
          name: "mcp__codex_app",
          tools: [
            {
              type: "function",
              name: "get_worktree_creation_status",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      ],
    };

    const out = openaiResponsesToOpenAIRequest("gpt-6-luna", body, true, null);
    const assistantMsg = out.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls[0].function.name).toBe(
      "mcp__codex_app__get_worktree_creation_status"
    );
    expect(assistantMsg.tool_calls[0].function.name).toMatch(OPENAI_TOOL_NAME_REGEX);
  });
  it("sanitizes dot-containing input and tool names in CodexExecutor transformRequest", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-6-luna",
      input: [
        {
          type: "function_call",
          call_id: "call_dotted",
          name: "mcp__codex_app.get_worktree_creation_status",
          arguments: "{}",
        },
        {
          type: "function_call_output",
          call_id: "call_dotted",
          output: "ok",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "mcp__codex_app.create_worktree",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "namespace",
          name: "mcp__ns",
          tools: [
            {
              type: "function",
              name: "sub.tool",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      ],
    };

    executor.transformRequest("gpt-6-luna", body, true, {
      connectionId: "test-conn",
      providerSpecificData: {},
    });

    const fc = body.input.find((item) => item.type === "function_call");
    expect(fc.name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(fc.name).toBe("mcp__codex_app_get_worktree_creation_status");

    // gpt-6-luna is a responsesLite model, so tools are moved to input[0] (additional_tools)
    const addTools = body.input.find((i) => i.type === "additional_tools");
    expect(addTools).toBeDefined();
    const fnTool = addTools.tools.find((t) => t.type === "function");
    expect(fnTool.name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(fnTool.name).toBe("mcp__codex_app_create_worktree");

    const nsTool = addTools.tools.find((t) => t.type === "namespace");
    expect(nsTool.tools[0].name).toMatch(OPENAI_TOOL_NAME_REGEX);
    expect(nsTool.tools[0].name).toBe("sub_tool");
  });

  it("normalizes native custom declarations, call history, and explicit choices together", () => {
    const body = {
      model: "gpt-6-luna",
      input: [
        { type: "custom_tool_call", call_id: "call_custom", name: "mcp.foo", input: "run" },
        { type: "custom_tool_call_output", call_id: "call_custom", output: "ok" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
      tools: [
        { type: "custom", name: "mcp.foo", format: { type: "text" } },
        { type: "function", name: "mcp.bar", parameters: { type: "object", properties: {} } },
      ],
      tool_choice: { type: "function", name: "mcp.bar" },
    };

    new CodexExecutor().transformRequest("gpt-6-luna", body, true, {
      connectionId: "test-conn",
      providerSpecificData: {},
    });

    const tools = body.input.find((item) => item.type === "additional_tools").tools;
    expect(tools.map((tool) => tool.name)).toEqual(["mcp_foo", "mcp_bar"]);
    expect(body.input.find((item) => item.type === "custom_tool_call").name).toBe("mcp_foo");
    expect(body.tool_choice).toEqual({ type: "function", name: "mcp_bar" });
    const nameMap = takeRenamedToolNames(body);
    expect(nameMap.get("mcp_foo")).toBe("mcp.foo");
    expect(nameMap.get("mcp_bar")).toBe("mcp.bar");
    expect(restoreToolNames({ output: [{ type: "custom_tool_call", name: "mcp_foo" }] }, nameMap).output[0].name)
      .toBe("mcp.foo");
  });

  it("normalizes declarations already carried in a Lite additional_tools prefix", () => {
    const body = {
      model: "gpt-6-luna",
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [
            { type: "custom", name: "mcp.foo", format: { type: "text" } },
            {
              type: "namespace",
              name: "mcp.ns",
              tools: [{ type: "function", name: "run.tool", parameters: { type: "object", properties: {} } }],
            },
          ],
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "run" }] },
      ],
    };

    new CodexExecutor().transformRequest("gpt-6-luna", body, true, {
      connectionId: "test-conn",
      providerSpecificData: {},
    });

    const tools = body.input.find((item) => item.type === "additional_tools").tools;
    expect(tools[0].name).toBe("mcp_foo");
    expect(tools[1].name).toBe("mcp_ns");
    expect(tools[1].tools[0].name).toBe("run_tool");
  });

  it("keeps colliding native tool aliases distinct and preserves valid names", () => {
    const body = {
      model: "gpt-6-luna",
      input: [
        { type: "custom_tool_call", call_id: "call_dot", name: "foo.bar", input: "run" },
        { type: "custom_tool_call_output", call_id: "call_dot", output: "ok" },
        { type: "custom_tool_call", call_id: "call_slash", name: "foo/bar", input: "run" },
        { type: "custom_tool_call_output", call_id: "call_slash", output: "ok" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
      tools: [
        { type: "custom", name: "foo.bar", format: { type: "text" } },
        { type: "function", name: "foo_bar", parameters: { type: "object", properties: {} } },
        { type: "custom", name: "foo/bar", format: { type: "text" } },
      ],
    };

    new CodexExecutor().transformRequest("gpt-6-luna", body, true, {
      connectionId: "test-conn",
      providerSpecificData: {},
    });

    const tools = body.input.find((item) => item.type === "additional_tools").tools;
    expect(tools.map((tool) => tool.name)).toEqual(["foo_bar_2", "foo_bar", "foo_bar_3"]);
    expect(body.input.filter((item) => item.type === "custom_tool_call").map((item) => item.name))
      .toEqual(["foo_bar_2", "foo_bar_3"]);
    const nameMap = takeRenamedToolNames(body);
    expect(nameMap.get("foo_bar_2")).toBe("foo.bar");
    expect(nameMap.get("foo_bar_3")).toBe("foo/bar");
  });
});
