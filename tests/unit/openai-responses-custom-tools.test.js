import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: "/tmp/test-9router-data",
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

import {
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

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

describe("Codex Responses Lite custom tools → OpenAI Chat", () => {
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
    expect(out._customToolNames).toContain("exec");
    expect(out.messages.some((message) => message.role === "developer")).toBe(false);
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
    expect(out._customToolNames).toContain("exec");
  });

  it("unpacks namespace tools in additional_tools and body.tools into top-level function declarations", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      tools: [
        {
          type: "namespace",
          name: "clock",
          tools: [{ type: "function", name: "get_time", parameters: { type: "object", properties: {} } }],
        },
      ],
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [
            {
              type: "namespace",
              name: "functions",
              tools: [EXEC_TOOL, { type: "function", name: "wait", parameters: { type: "object", properties: {} } }],
            },
            {
              type: "namespace",
              name: "collaboration",
              tools: [{ type: "function", name: "spawn_agent", parameters: { type: "object", properties: { target: { type: "string" } } } }],
            },
          ],
        },
      ],
    }, true, null);

    const toolNames = out.tools.map((tool) => tool.function.name);
    expect(toolNames).toEqual(["get_time", "exec", "wait", "spawn_agent"]);
    expect(out._customToolNames).toContain("exec");
    expect(out._customToolNames).toContain("functions.exec");
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

  it("normalizes namespaced functions.exec tool calls to exec custom_tool_call", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec", "functions.exec"]);
    const chunks = [
      { id: "chatcmpl-ns", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_ns", type: "function", function: { name: "functions.exec", arguments: "{\"input\":\"await tools.exec_command({cmd: \\\"ls\\\"});\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-ns", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.find((event) => event.event === "response.output_item.added");
    const done = events.find((event) => event.event === "response.output_item.done");

    expect(added.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_ns",
      name: "exec",
    });
    expect(done.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_ns",
      name: "exec",
      input: 'await tools.exec_command({cmd: "ls"});',
    });
  });

  it("keeps ordinary function named exec as function_call when not declared as custom", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["custom_runner"]);
    const chunks = [
      { id: "chatcmpl-exec", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_ord", type: "function", function: { name: "exec", arguments: "{\"command\":\"ls\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-exec", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.find((event) => event.event === "response.output_item.added");
    const done = events.find((event) => event.event === "response.output_item.done");

    expect(added.data.item.type).toBe("function_call");
    expect(done.data.item).toMatchObject({
      type: "function_call",
      call_id: "call_ord",
      name: "exec",
      arguments: '{"command":"ls"}',
    });
  });

  it("normalizes namespaced tool calls in assistant message history", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        {
          type: "message",
          role: "assistant",
          content: [],
        },
        {
          type: "custom_tool_call",
          call_id: "call_hist_1",
          name: "functions.exec",
          input: 'tools.exec_command({cmd: "pwd"});',
        },
      ],
    }, true, null);

    const assistantMsg = out.messages.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls[0].function.name).toBe("exec");
  });

  it("preserves _customToolNames across multi-hop translation (responses -> openai -> gemini)", async () => {
    const { translateRequest, initTranslators } = await import("../../open-sse/translator/index.js");
    await initTranslators();
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.GEMINI,
      "gemini-3.8-flash",
      {
        input: [
          {
            type: "additional_tools",
            tools: [
              {
                type: "namespace",
                name: "functions",
                tools: [EXEC_TOOL],
              },
            ],
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Run pwd" }],
          },
        ],
      },
      true,
      null,
      "antigravity"
    );
    expect(out._customToolNames).toContain("exec");
    expect(out._customToolNames).toContain("functions.exec");
  });

  it("does not delete legitimate parameter properties named encrypted in Gemini schema cleaning", async () => {
    const { cleanJSONSchemaForAntigravity } = await import("../../open-sse/translator/formats/gemini.js");
    const schema = {
      type: "object",
      properties: {
        encrypted: {
          type: "boolean",
          description: "Whether data is encrypted",
        },
        payload: {
          type: "string",
          encrypted: true,
        },
      },
    };
    const cleaned = cleanJSONSchemaForAntigravity(schema);
    expect(cleaned.properties.encrypted).toBeDefined();
    expect(cleaned.properties.encrypted.type).toBe("boolean");
    expect(cleaned.properties.payload.encrypted).toBeUndefined();
  });

  it("normalizes namespaced tools in non-streaming responses", () => {
    const raw = {
      id: "chatcmpl-test",
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "functions.exec", arguments: '{"input":"pwd"}' },
              },
            ],
          },
        },
      ],
    };
    const res = translateNonStreamingResponse(raw, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, new Set(["exec"]));
    expect(res.output[0]).toMatchObject({
      type: "custom_tool_call",
      name: "exec",
      input: "pwd",
    });
  });
});
