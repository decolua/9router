import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

// Representative OpenCode subagent contract: omission spawns; a supplied ID resumes.
const model = "gpt-5.6-sol";
const newSessionArgs = {
  agent: "explore",
  description: "Verify subagent routing",
  prompt: "Return exactly ROUTED-SUBAGENT-OK and nothing else.",
  background: false,
};
const parameters = {
  type: "object",
  properties: {
    agent: { type: "string" },
    description: { type: "string" },
    prompt: { type: "string" },
    sessionID: { type: "string", description: "Existing child session to resume; omit to create one." },
    background: { type: "boolean" },
  },
  required: ["agent", "description", "prompt", "background"],
  additionalProperties: false,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const chatTool = (schema = parameters, options = {}) => ({
  type: "function",
  function: { name: "subagent", description: "Run a child agent", parameters: clone(schema), ...options },
});
const request = (tool = chatTool()) => ({
  model,
  messages: [{ role: "user", content: "Start a new explore child session." }],
  tools: [tool],
});
const translate = (body) => openaiToOpenAIResponsesRequest(model, body, true, {});
// Check the serialized provider body, not just an intermediate object whose
// strict: undefined disappears when JSON.stringify sends it upstream.
const dispatch = (body) => clone(new CodexExecutor().transformRequest(model, body, true, {}));

function assertSchemaUnchanged(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.equal(Object.hasOwn(actual, "required"), Object.hasOwn(expected, "required"));
}

describe("Chat Completions to Responses optional function parameters", () => {
  const allOptional = clone(parameters);
  delete allOptional.required;
  const emptyRequired = { ...clone(parameters), required: [] };
  const nested = {
    type: "object",
    properties: {
      options: {
        type: "object",
        properties: { prompt: { type: "string" }, sessionID: { type: "string" } },
        required: ["prompt"],
      },
      children: { type: "array", items: allOptional },
      resume: { anyOf: [{ $ref: "#/$defs/child" }, { type: "null" }] },
    },
    required: ["options"],
    $defs: { child: emptyRequired },
  };

  for (const [label, schema] of [
    ["optional sessionID", parameters],
    ["absent required", allOptional],
    ["empty required", emptyRequired],
    ["nested objects, arrays, unions and definitions", nested],
    ["object without properties", { type: "object", required: [] }],
  ]) {
    it(`preserves ${label} through translation and Codex normalization`, () => {
      const body = request(chatTool(schema));
      const original = clone(body);
      const expected = schema.properties ? schema : { ...schema, properties: {} };
      const translated = clone(translate(body));
      assertSchemaUnchanged(translated.tools[0].parameters, expected);
      assert.equal(translated.tools[0].strict, false);
      const outbound = dispatch(translated);
      assertSchemaUnchanged(outbound.tools[0].parameters, expected);
      assert.equal(outbound.tools[0].strict, false);
      assert.deepStrictEqual(body, original, "the incoming schema must not be mutated");
    });
  }

  for (const strict of [false, true, null]) {
    it(`preserves explicit Chat strict=${strict} (null uses the Chat default)`, () => {
      const schema = clone(parameters);
      // An explicit strict request must already have a strict-compatible schema.
      if (strict === true) schema.required = Object.keys(schema.properties);
      const translated = clone(translate(request(chatTool(schema, { strict }))));
      assert.equal(translated.tools[0].strict, strict ?? false);
      const outbound = dispatch(translated);
      assert.equal(outbound.tools[0].strict, strict ?? false);
      assertSchemaUnchanged(outbound.tools[0].parameters, schema);
    });
  }

  it("does not silently repair an explicitly strict schema by requiring optional fields", () => {
    const outbound = dispatch(translate(request(chatTool(parameters, { strict: true }))));
    assert.equal(outbound.tools[0].strict, true);
    assertSchemaUnchanged(outbound.tools[0].parameters, parameters);
  });

  it("keeps parameter-less functions non-strict without inventing required", () => {
    const tool = chatTool();
    delete tool.function.parameters;
    const outbound = dispatch(translate(request(tool)));
    assert.deepStrictEqual(outbound.tools[0].parameters, { type: "object", properties: {} });
    assert.equal(outbound.tools[0].strict, false);
  });
});

describe("Codex tool normalization strictness", () => {
  for (const strict of [undefined, false, true, null]) {
    it(`retains native Responses strict=${strict} without changing its default`, () => {
      const tool = { type: "function", name: "subagent", parameters: clone(parameters) };
      if (strict !== undefined) tool.strict = strict;
      const body = { model, input: "Start a child session.", tools: [tool] };
      const outbound = dispatch(translate(body));
      assert.equal(Object.hasOwn(outbound.tools[0], "strict"), strict !== undefined);
      assert.equal(outbound.tools[0].strict, strict);
      assertSchemaUnchanged(outbound.tools[0].parameters, parameters);
    });

    it(`handles a nested Chat tool reaching the executor with strict=${strict}`, () => {
      const options = strict === undefined ? {} : { strict };
      const outbound = dispatch({ model, input: "Start a child session.", tools: [chatTool(parameters, options)] });
      assert.equal(outbound.tools[0].strict, strict ?? false);
      assert.equal(Object.hasOwn(outbound.tools[0], "function"), false);
      assertSchemaUnchanged(outbound.tools[0].parameters, parameters);
    });
  }

  it("is idempotent and keeps unrelated tool metadata filtered", () => {
    const body = translate(request(chatTool()));
    body.tools[0]._clientOnly = "must not reach upstream";
    const first = dispatch(body);
    const second = dispatch(clone(first));
    assert.deepStrictEqual(second.tools, first.tools);
    assert.equal(first.tools[0].strict, false);
    assert.equal(Object.hasOwn(first.tools[0], "_clientOnly"), false);
  });

  it("does not rewrite hosted, custom or namespaced native tools", () => {
    const tools = [
      { type: "web_search" },
      { type: "custom", name: "freeform", format: { type: "text" } },
      { type: "namespace", name: "agents", tools: [
        { type: "function", name: "subagent", parameters: clone(parameters), strict: false },
      ] },
    ];
    const outbound = dispatch({ model, input: "hi", tools: clone(tools) });
    assert.deepStrictEqual(outbound.tools, tools);
  });
});

describe("Responses tool arguments preserve omission and explicit resume IDs", () => {
  for (const [label, args] of [
    ["new child without sessionID", newSessionArgs],
    ["resume existing child", { ...newSessionArgs, sessionID: "ses_existing_child" }],
  ]) {
    it(`preserves ${label} in replayed conversation history`, () => {
      const body = request();
      const argumentsText = JSON.stringify(args);
      body.messages.push({ role: "assistant", content: null, tool_calls: [
        { id: "call_subagent", type: "function", function: { name: "subagent", arguments: argumentsText } },
      ] });
      const outbound = dispatch(translate(body));
      const call = outbound.input.find((item) => item.type === "function_call");
      assert.equal(call.arguments, argumentsText);
      assert.deepStrictEqual(JSON.parse(call.arguments), args);
    });

    for (const mode of ["fragmented deltas", "done-only arguments"]) {
      it(`preserves ${label} in streamed ${mode}`, () => {
        // Synthetic upstream events test transport fidelity, not model behavior
        // or OpenCode execution. Live child creation is a separate acceptance test.
        const text = JSON.stringify(args);
        const item = { id: "fc_subagent", type: "function_call", call_id: "call_subagent", name: "subagent" };
        const events = [{ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } }];
        if (mode === "fragmented deltas") {
          for (let offset = 0; offset < text.length; offset += 7) {
            events.push({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: text.slice(offset, offset + 7) });
          }
          events.push({ type: "response.function_call_arguments.done", item_id: item.id, arguments: text });
        }
        events.push({ type: "response.output_item.done", output_index: 0, item: { ...item, arguments: text } });
        events.push({ type: "response.completed", response: { status: "completed" } });
        const state = { model };
        const chunks = events.map((event) => openaiResponsesToOpenAIResponse(event, state)).filter(Boolean);
        const calls = chunks.flatMap((chunk) => chunk.choices[0].delta.tool_calls || []);
        const rawInput = calls.map((call) => call.function?.arguments || "").join("");
        assert.equal(rawInput, text, "arguments must not be injected, removed or duplicated");
        assert.deepStrictEqual(JSON.parse(rawInput), args);
        assert.equal(Object.hasOwn(JSON.parse(rawInput), "sessionID"), Object.hasOwn(args, "sessionID"));
        assert.equal(chunks.at(-1).choices[0].finish_reason, "tool_calls");
      });
    }
  }
});
