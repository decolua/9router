import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { createNamespaceToolBridge, restoreNamespaceToolCalls } from "../../open-sse/translator/concerns/responsesNamespaces.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const schema = {
  type: "object",
  properties: { message: { type: "string" }, agent_type: { type: "string", enum: ["default", "explorer"] } },
  required: ["message"],
  additionalProperties: false,
};
const namespace = {
  type: "namespace",
  name: "multi_agent_v1",
  description: "Native agents",
  tools: [{ type: "function", name: "spawn_agent", description: "Spawn an agent", parameters: schema, strict: true }],
};
const request = () => ({ input: [{ role: "user", content: "Test" }], tools: [structuredClone(namespace)] });
const translate = body => openaiResponsesToOpenAIRequest("test", body, true);
const chatChunk = (name, index = 0) => ({
  id: "chatcmpl-test",
  choices: [{ index: 0, delta: { tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name, arguments: '{"message":"CHILD_OK"}' } }] }, finish_reason: null }],
});
const chatBody = name => ({
  id: "chatcmpl-test", model: "test",
  choices: [{ message: { role: "assistant", tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: '{"message":"CHILD_OK"}' } }] }, finish_reason: "tool_calls" }],
});

describe("Responses namespaces through the OpenAI bridge", () => {
  it("ignores malformed input entries without losing namespace declarations", () => {
    const body = request();
    body.input.unshift(null, undefined);
    expect(translate(body)._namespaceToolMap.size).toBe(1);
  });

  it("keeps sanitized names reversible for Unicode and punctuation", () => {
    const tools = ["a.b", "a/b", "漢字", "ns_spawn_agent_existing"].map(name => ({
      ...structuredClone(namespace), tools: [{ type: "function", name, parameters: schema }],
    }));
    const out = translate({ input: [], tools });
    expect(new Set(out.tools.map(tool => tool.function.name)).size).toBe(4);
    for (const tool of out.tools) {
      expect(tool.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(out._namespaceToolMap.get(tool.function.name).namespace).toBe(namespace.name);
    }
    expect([...out._namespaceToolMap.values()].map(identity => identity.name)).toEqual(["a.b", "a/b", "漢字", "ns_spawn_agent_existing"]);
  });
  it("flattens nested declarations without losing schema, description or strictness", () => {
    const body = request();
    body.tools.push({ type: "function", name: "exec_command", parameters: schema });
    const out = translate(body);
    expect(out.tools).toHaveLength(2);
    const flatName = out.tools[0].function.name;
    expect(flatName).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(flatName.length).toBeLessThanOrEqual(64);
    expect(out.tools[0].function).toMatchObject({ parameters: schema, strict: true });
    expect(out.tools[0].function.description).toContain("multi_agent_v1");
    expect(out._namespaceToolMap.get(flatName)).toEqual({ namespace: "multi_agent_v1", name: "spawn_agent" });
    expect(out.tools[1].function.name).toBe("exec_command");
    expect(body.tools[0]).toEqual(namespace);
  });

  it("keeps duplicate nested names in separate namespaces distinct", () => {
    const body = request();
    body.tools.push({ ...structuredClone(namespace), name: "other_agents" });
    const out = translate(body);
    expect(new Set(out.tools.map(tool => tool.function.name)).size).toBe(2);
    expect(out._namespaceToolMap.size).toBe(2);
  });

  it("avoids collisions with flat functions and bounds long names", () => {
    const first = createNamespaceToolBridge([namespace]);
    const generatedName = first.flattenedTools[0].name;
    const second = createNamespaceToolBridge([{ type: "function", name: generatedName }, namespace]);
    expect(second.flattenedTools[1].name).not.toBe(generatedName);
    expect(second.flattenName("x".repeat(200), "y".repeat(200)).length).toBeLessThanOrEqual(64);
    expect(first.flattenName(namespace.name, "spawn_agent")).toBe(generatedName);
  });

  it("uses the same names for replayed calls, including declarations after the call", () => {
    const body = request();
    body.input = [
      { type: "function_call", namespace: namespace.name, name: "spawn_agent", call_id: "call_1", arguments: '{"message":"Test"}' },
      { type: "function_call_output", call_id: "call_1", output: "agent_1" },
      { type: "additional_tools", tools: body.tools },
    ];
    body.tools = [];
    const out = translate(body);
    expect(out.messages[0].tool_calls[0].function.name).toBe(out.tools[0].function.name);
    expect(out.messages[1]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "agent_1" });
  });

  it("maps named tool_choice to the flattened declaration", () => {
    const body = request();
    body.tool_choice = { type: "function", namespace: namespace.name, name: "spawn_agent" };
    const out = translate(body);
    expect(out.tool_choice).toEqual({ type: "function", function: { name: out.tools[0].function.name } });
  });

  it("eagerly exposes deferred tools instead of pretending hosted tool_search works", () => {
    const body = request();
    body.tools[0].tools[0].defer_loading = true;
    body.tools.push({ type: "tool_search", execution: "sync" }, { type: "web_search", name: "hosted_search" });
    const out = translate(body);
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].function).not.toHaveProperty("defer_loading");
    expect(out.tools[0].function.parameters).toEqual(schema);
  });

  it("preserves namespace metadata through the Responses to Claude pivot", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "test", request(), true);
    expect(out._namespaceToolMap.size).toBe(1);
    expect(out._namespaceToolMap.get(out.tools[0].name)).toEqual({ namespace: namespace.name, name: "spawn_agent" });
  });

  it("restores namespaces in added, done, and completed streaming events", () => {
    const out = translate(request());
    const state = { ...initState(FORMATS.OPENAI_RESPONSES), namespaceToolMap: out._namespaceToolMap };
    const events = [chatChunk(out.tools[0].function.name), { choices: [{ delta: {}, finish_reason: "tool_calls" }] }, null]
      .flatMap(chunk => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));
    for (const type of ["response.output_item.added", "response.output_item.done"]) {
      expect(events.find(event => event.event === type).data.item).toMatchObject({ namespace: namespace.name, name: "spawn_agent", call_id: "call_0" });
    }
    expect(events.find(event => event.event === "response.completed").data.response.output[0])
      .toMatchObject({ namespace: namespace.name, name: "spawn_agent", arguments: '{"message":"CHILD_OK"}' });
  });

  it("restores namespaces for custom tools without rewriting raw input", () => {
    const body = request();
    body.tools[0].tools = [{ type: "custom", name: "js", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }];
    const out = translate(body);
    const flatName = out.tools[0].function.name;
    const response = chatBody(flatName);
    response.choices[0].message.tool_calls[0].function.arguments = '{"input":"return 1;"}';
    const restored = translateNonStreamingResponse(response, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, new Set(out._customToolNames), out._namespaceToolMap);
    expect(restored.output[0]).toMatchObject({ type: "custom_tool_call", namespace: namespace.name, name: "js", input: "return 1;" });
  });

  it("restores streaming namespaced custom tools and raw JSON-looking input", () => {
    const body = request();
    body.tools[0].tools = [{ type: "custom", name: "js" }];
    const out = translate(body);
    const state = {
      ...initState(FORMATS.OPENAI_RESPONSES),
      namespaceToolMap: out._namespaceToolMap, customToolNames: new Set(out._customToolNames),
    };
    const chunk = chatChunk(out.tools[0].function.name);
    const rawInput = '{"name":"spawn_agent","namespace":"other"}';
    chunk.choices[0].delta.tool_calls[0].function.arguments = JSON.stringify({ input: rawInput });
    const events = [chunk, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }, null]
      .flatMap(item => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, item, state));
    expect(events.find(event => event.event === "response.output_item.done").data.item)
      .toMatchObject({ type: "custom_tool_call", namespace: namespace.name, name: "js", input: rawInput });
  });

  it("restores non-stream JSON calls while leaving unrelated JSON fields unchanged", () => {
    const out = translate(request());
    const restored = translateNonStreamingResponse(chatBody(out.tools[0].function.name), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, out._namespaceToolMap);
    expect(restored.output[0]).toMatchObject({ type: "function_call", namespace: namespace.name, name: "spawn_agent" });
    const untouched = { type: "message", content: [{ name: out.tools[0].function.name }] };
    expect(restoreNamespaceToolCalls(untouched, out._namespaceToolMap)).toEqual(untouched);
  });

  it("restores forced-SSE JSON calls", async () => {
    const out = translate(request());
    const raw = [chatChunk(out.tools[0].function.name), { choices: [{ delta: {}, finish_reason: "tool_calls" }] }]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI,
      provider: "test", model: "test", body: {}, requestStartTime: Date.now(),
      namespaceToolMap: out._namespaceToolMap, trackDone: vi.fn(), appendLog: vi.fn(),
    });
    expect(result.success).toBe(true);
    expect((await result.response.json()).output[0]).toMatchObject({ namespace: namespace.name, name: "spawn_agent" });
  });
});
