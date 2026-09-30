import { describe, expect, it } from "vitest";
import {
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";

const EXEC_TOOL = {
  type: "custom",
  name: "exec",
  description: "Run JavaScript code to orchestrate tool calls.",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: "start: /(.|\\n)+/",
  },
};

const DEFERRED_GROUP = {
  type: "namespace",
  name: "mcp__prod",
  tools: [{
    type: "function",
    name: "list_ai_investigations",
    defer_loading: true,
    parameters: { type: "object", properties: {} },
  }],
};

const JS_NAMESPACES = [
  { type: "namespace", name: "mcp__cua_repl", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
  { type: "namespace", name: "mcp__node_repl", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
];

describe("Codex Responses Lite custom tools → OpenAI Chat", () => {
  it("advertises namespace children as callable Chat tools instead of their groups", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [{
            type: "namespace",
            name: "functions",
            tools: [
              {
                type: "function",
                name: "exec_command",
                description: "Run a shell command",
                parameters: {
                  type: "object",
                  properties: { cmd: { type: "string" } },
                  required: ["cmd"],
                },
              },
              {
                type: "function",
                name: "write_stdin",
                parameters: { type: "object", properties: { session_id: { type: "integer" } } },
              },
            ],
          }],
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
      ],
      tools: [
        {
          type: "namespace",
          name: "clock",
          tools: [{ type: "function", name: "curr_time", parameters: { type: "object", properties: {} } }],
        },
        {
          type: "namespace",
          name: "mcp__cua_repl",
          tools: [{ type: "function", name: "js", parameters: { type: "object", properties: { code: { type: "string" } } } }],
        },
      ],
    }, true, null);

    expect(out.tools.map((tool) => tool.function.name)).toEqual([
      "clock__curr_time",
      "mcp__cua_repl__js",
      "functions__exec_command",
      "functions__write_stdin",
    ]);
    expect(out._toolNameMap.get("mcp__cua_repl__js")).toBe("mcp__cua_repl.js");
    expect(out.tools.find((tool) => tool.function.name === "functions__exec_command").function.parameters).toEqual({
      type: "object",
      properties: { cmd: { type: "string" } },
      required: ["cmd"],
    });
  });

  it("promotes additional_tools custom declarations into Chat tools", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [EXEC_TOOL] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
      ],
      tool_choice: "auto",
    }, true, null);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "exec",
        parameters: {
          type: "object",
          required: ["input"],
          properties: { input: { type: "string" } },
        },
      },
    });
    expect(out._customToolNames).toEqual(["exec"]);
    expect(out.messages.some((message) => message.role === "developer")).toBe(false);
  });

  it("keeps deferred namespace children unloaded until additional_tools activates them", () => {
    const before = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: "Find an investigation",
      tools: [DEFERRED_GROUP],
    }, true, null);
    expect(before.tools || []).toHaveLength(0);

    const after = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: [
        { type: "additional_tools", role: "developer", tools: [DEFERRED_GROUP] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Find an investigation" }] },
      ],
      tools: [DEFERRED_GROUP],
    }, true, null);
    expect(after.tools.map((tool) => tool.function.name)).toEqual(["mcp__prod__list_ai_investigations"]);
    expect(after._toolNameMap.get("mcp__prod__list_ai_investigations")).toBe("mcp__prod.list_ai_investigations");
  });

  it("advertises same-named children from different namespaces as distinct callable tools", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: "Run JS",
      tools: JS_NAMESPACES,
    }, true, null);

    expect(out.tools.map((tool) => tool.function.name)).toEqual([
      "mcp__cua_repl__js",
      "mcp__node_repl__js",
    ]);
    expect([...out._toolNameMap]).toEqual([
      ["mcp__cua_repl__js", "mcp__cua_repl.js"],
      ["mcp__node_repl__js", "mcp__node_repl.js"],
    ]);
  });

  it("uses the same aliases in tool history and an explicit tool choice", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: [
        { type: "function_call", call_id: "call_js", name: "mcp__cua_repl.js", arguments: "{}" },
        { type: "function_call_output", call_id: "call_js", output: "done" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Continue" }] },
      ],
      tools: JS_NAMESPACES,
      tool_choice: { type: "function", name: "mcp__node_repl.js" },
    }, true, null);

    expect(out.messages.find((message) => message.role === "assistant").tool_calls[0].function.name).toBe("mcp__cua_repl__js");
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "mcp__node_repl__js" } });
  });

  it("keeps namespace aliases valid and unique when names are long or overlap a top-level tool", () => {
    const longPrefix = "mcp__very_long_namespace_".repeat(4);
    const out = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: "Run JS",
      tools: [
        { type: "function", name: "mcp__cua_repl__js", parameters: { type: "object", properties: {} } },
        ...JS_NAMESPACES,
        { type: "namespace", name: longPrefix + "a", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
        { type: "namespace", name: longPrefix + "b", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
      ],
    }, true, null);

    const names = out.tools.map((tool) => tool.function.name);
    expect(names[0]).toBe("mcp__cua_repl__js");
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name))).toBe(true);
    expect(out._toolNameMap.get(names[1])).toBe("mcp__cua_repl.js");
  });

  it("preserves namespace restoration through a Claude request pivot", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-sonnet-4", {
      input: "Run JS",
      tools: JS_NAMESPACES,
    }, true, { apiKey: "test-key" });

    expect(out.tools.map((tool) => tool.name)).toEqual([
      "mcp__cua_repl__js",
      "mcp__node_repl__js",
    ]);
    expect(out._toolNameMap.get("mcp__cua_repl__js")).toBe("mcp__cua_repl.js");
    expect(out._toolNameMap.get("mcp__node_repl__js")).toBe("mcp__node_repl.js");
  });

  it("restores qualified names in streamed tool events and terminal output", () => {
    const request = openaiResponsesToOpenAIRequest("cx/gpt-6-luna", {
      input: "Run JS",
      tools: JS_NAMESPACES,
    }, true, null);
    const alias = request.tools[1].function.name;
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.targetFormat = FORMATS.OPENAI;
    state.toolNameMap = request._toolNameMap;

    const events = [
      {
        id: "chatcmpl-js",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_js", type: "function", function: { name: alias, arguments: "{}" } }] }, finish_reason: null }],
      },
      {
        id: "chatcmpl-js",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
    ].flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));

    const toolEvents = events.filter((event) => event.event === "response.output_item.added" || event.event === "response.output_item.done");
    expect(toolEvents.map((event) => event.data.item.name)).toEqual(["mcp__node_repl.js", "mcp__node_repl.js"]);
    expect(events.find((event) => event.event === "response.completed").data.response.output[0].name).toBe("mcp__node_repl.js");
    expect(restoreToolNames({ output: [{ type: "function_call", name: alias }] }, request._toolNameMap).output[0].name).toBe("mcp__node_repl.js");
  });

  it("translates custom tool call/output history into Chat assistant/tool messages", () => {
    const program = "const result = await tools.shell({command: 'pwd'});\nreturn result;";
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [EXEC_TOOL] },
        { type: "custom_tool_call", call_id: "call_exec_1", name: "exec", input: program },
        { type: "custom_tool_call_output", call_id: "call_exec_1", output: "/srv/app" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Continue" }] },
      ],
    }, true, null);

    const assistant = out.messages.find((message) => message.role === "assistant");
    expect(assistant.tool_calls[0]).toMatchObject({
      id: "call_exec_1",
      type: "function",
      function: { name: "exec" },
    });
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ input: program });
    expect(out.messages.find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call_exec_1",
      content: "/srv/app",
    });
  });

  it("merges additional_tools with normal top-level function tools", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [{ type: "additional_tools", role: "developer", tools: [EXEC_TOOL] }],
      tools: [{ type: "function", name: "search", parameters: { type: "object", properties: {} } }],
    }, true, null);

    expect(out.tools.map((tool) => tool.function.name)).toEqual(["search", "exec"]);
    expect(out._customToolNames).toEqual(["exec"]);
  });
});

describe("OpenAI Chat stream → Codex custom_tool_call", () => {
  it("unwraps the Chat input parameter and emits custom-tool events", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const chunks = [
      {
        id: "chatcmpl-custom",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_exec_2", type: "function", function: { name: "exec", arguments: "" } }] }, finish_reason: null }],
      },
      {
        id: "chatcmpl-custom",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"input\":\"const x = await tools.shell({command: 'pwd'});\"}" } }] }, finish_reason: null }],
      },
      { id: "chatcmpl-custom", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.find((event) => event.event === "response.output_item.added");
    const delta = events.find((event) => event.event === "response.custom_tool_call_input.delta");
    const done = events.find((event) => event.event === "response.output_item.done");

    expect(added.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_exec_2",
      name: "exec",
      input: "",
    });
    expect(delta.data.delta).toBe("const x = await tools.shell({command: 'pwd'});");
    expect(done.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_exec_2",
      name: "exec",
      input: "const x = await tools.shell({command: 'pwd'});",
    });
    expect(events.some((event) => event.event === "response.function_call_arguments.delta")).toBe(false);
  });

  it("waits for the function name when id and name arrive in separate chunks", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const chunks = [
      { id: "chatcmpl-split", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_split", type: "function", function: { arguments: "" } }] }, finish_reason: null }] },
      { id: "chatcmpl-split", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "exec", arguments: "{\"input\":\"return 1;\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-split", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.filter((event) => event.event === "response.output_item.added");
    expect(added).toHaveLength(1);
    expect(added[0].data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_split",
      name: "exec",
    });
  });

  it("leaves normal Chat tool calls as Responses function_call events", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const events = [
      { id: "chatcmpl-normal", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_search", type: "function", function: { name: "search", arguments: "{\"q\":\"x\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-normal", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));

    expect(events.find((event) => event.event === "response.output_item.added").data.item.type).toBe("function_call");
    expect(events.find((event) => event.event === "response.output_item.done").data.item).toMatchObject({
      type: "function_call",
      name: "search",
      arguments: "{\"q\":\"x\"}",
    });
  });
});
