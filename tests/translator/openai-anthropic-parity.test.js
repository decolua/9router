// Translator parity tests for OpenAI Responses API and Claude ↔ OpenAI conversion.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body, model = "m") => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, model, body, true, null, null);
const O2R = (body, model = "m") => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, model, body, true, null, null);
const O2C = (body, model = "claude-opus-4") => translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, body, true, { apiKey: "sk-x" }, "anthropic");
const C2O = (body, model = "claude-opus-4") => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, model, body, true, { apiKey: "sk-x" }, "anthropic");

describe("OpenAI Responses API → OpenAI chat", () => {
  it("converts input[] messages to messages[]", () => {
    const out = R2O({
      input: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(Array.isArray(out.messages)).toBe(true);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toMatchObject({ role: "system", content: "You are helpful." });
    expect(out.messages[1]).toMatchObject({ role: "user", content: "Hello" });
  });

  it("converts instructions to system message", () => {
    const out = R2O({
      instructions: "Be concise.",
      input: [{ role: "user", content: "Hi" }],
    });
    expect(out.messages[0]).toMatchObject({ role: "system", content: "Be concise." });
    expect(out.messages[1]).toMatchObject({ role: "user", content: "Hi" });
  });

  it("passes through tools", () => {
    const tools = [{ type: "function", function: { name: "get_weather", description: "Weather", parameters: { type: "object" } } }];
    const out = R2O({ input: [{ role: "user", content: "Hi" }], tools });
    expect(out.tools).toEqual(tools);
  });

  it("maps function_call input items to assistant tool_calls", () => {
    const out = R2O({
      input: [
        { role: "user", content: "What's the weather?" },
        { type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"NYC"}' },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst).toBeDefined();
    expect(asst.tool_calls).toHaveLength(1);
    expect(asst.tool_calls[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"NYC"}' },
    });
  });

  it("maps function_call_output to tool message", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{}" },
        { type: "function_call_output", call_id: "call_1", output: "sunny" },
      ],
    });
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "sunny" });
  });

  it("drops empty assistant content when tool_calls present", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{}" },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst.tool_calls).toHaveLength(1);
  });
});

describe("OpenAI chat → OpenAI Responses API", () => {
  it("converts messages[] to input[] and instructions", () => {
    const out = O2R({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(out.instructions).toBe("You are helpful.");
    expect(Array.isArray(out.input)).toBe(true);
    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({ type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] });
  });

  it("clamps call_id to 64 chars", () => {
    const longId = "call_" + "x".repeat(80);
    const out = O2R({
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: longId, type: "function", function: { name: "f", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: longId, content: "ok" },
      ],
    });
    const fc = out.input.find((i) => i.type === "function_call");
    expect(fc.call_id.length).toBeLessThanOrEqual(64);
  });
});

describe("OpenAI Responses API response stream", () => {
  it("initializes openai-responses state with required fields", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    expect(state.responseId).toMatch(/^resp_\d+$/);
    expect(typeof state.created).toBe("number");
    expect(state.seq).toBe(0);
    expect(state.completedSent).toBe(false);
  });
});

describe("Claude ↔ OpenAI conversion", () => {
  it("OpenAI → Claude: maps system message and user text", () => {
    const out = O2C({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(out.system).toBeDefined();
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "Hello" }] });
  });

  it("OpenAI → Claude: maps tool_calls to content blocks", () => {
    const out = O2C({
      messages: [
        { role: "user", content: "Weather?" },
        { role: "assistant", content: "", tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
        ] },
        { role: "tool", tool_call_id: "call_1", content: "sunny" },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst.content).toHaveLength(1);
    expect(asst.content[0]).toMatchObject({ type: "tool_use", name: "get_weather", input: { city: "NYC" } });
  });

  it("Claude → OpenAI: maps tool_use to tool_calls", () => {
    const out = C2O({
      messages: [
        { role: "user", content: "Weather?" },
        { role: "assistant", content: [
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } },
        ] },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    expect(asst.tool_calls).toHaveLength(1);
    expect(asst.tool_calls[0]).toMatchObject({
      id: "tu_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"NYC"}' },
    });
  });
});

describe("Claude response → OpenAI response", () => {
  it("translates a Claude message_start to OpenAI assistant role delta", () => {
    const state = initState(FORMATS.CLAUDE);
    const [delta] = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, {
      type: "message_start",
      message: { id: "msg_1", model: "claude-opus-4" },
    }, state);
    expect(delta).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" } }],
    });
  });

  it("translates a Claude text_delta to OpenAI content delta", () => {
    const state = initState(FORMATS.CLAUDE);
    state.messageId = "msg_1";
    state.model = "claude-opus-4";
    const [delta] = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    }, state);
    expect(delta).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "Hello" } }],
    });
  });
});
