import { describe, it, expect, vi, beforeEach } from "vitest";

// RED: test for #4091 - missing call_id in function_call_output must not break upstream

const fx = vi.hoisted(() => ({
  connections: [],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => fx.connections,
  getComboByName: async () => null,
  getCombos: async () => [],
  getSettings: async () => ({}),
  getModelAliases: async () => ({}),
  getProviderNodes: async () => [],
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (id) => id,
  FREE_PROVIDERS: {},
  getProviderAlias: (id) => id,
}));

const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");
const { ensureToolCallIds } = await import("../../open-sse/translator/concerns/toolCall.js");

describe("openai-responses missing tool_call_id (#4091)", () => {
  beforeEach(() => {
    fx.connections = [{ provider: "openai", isActive: true, apiKey: "sk-test" }];
    vi.clearAllMocks();
  });

  it("function_call_output without call_id gets a deterministic repair id", async () => {
    const body = {
      model: "test-model",
      input: [
        { type: "message", role: "user", content: [ { type: "input_text", text: "hi" } ] },
        { type: "function_call", name: "exec", arguments: "{}", call_id: "call_1" },
        { type: "function_call_output", output: "ok" } // MISSING call_id
      ],
      tools: [{ type: "function", name: "exec", parameters: { type: "object", properties: {} } }],
    };

    const result = openaiResponsesToOpenAIRequest("model", body, false, null);
    
    // Find the tool message
    const toolMsg = result.messages.find(m => m.role === "tool");
    expect(toolMsg).toBeDefined();
    // After fix: tool_call_id should be present, not undefined
    expect(toolMsg.tool_call_id).toBeDefined();
    expect(toolMsg.tool_call_id).not.toBe("undefined");
    expect(toolMsg.tool_call_id).toMatch(/^call_/); // deterministic prefix
  });

  it("custom_tool_call_output without call_id also gets repaired", async () => {
    const body = {
      model: "test-model",
      input: [
        { type: "message", role: "user", content: [ { type: "input_text", text: "hi" } ] },
        { type: "custom_tool_call", name: "custom_tool", input: "{}", call_id: "call_2" },
        { type: "custom_tool_call_output", output: "ok" } // MISSING call_id
      ],
      tools: [{ type: "function", name: "custom_tool", parameters: { type: "object", properties: {} } }],
    };

    const result = openaiResponsesToOpenAIRequest("model", body, false, null);
    const toolMsg = result.messages.find(m => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBeDefined();
    expect(toolMsg.tool_call_id).toMatch(/^call_/);
  });

  it("multiple missing call_id get unique ids", async () => {
    const body = {
      model: "test-model",
      input: [
        { type: "message", role: "user", content: [ { type: "input_text", text: "hi" } ] },
        { type: "function_call", name: "t1", arguments: "{}", call_id: "call_1" },
        { type: "function_call_output", output: "ok1" }, // missing
        { type: "function_call", name: "t2", arguments: "{}", call_id: "call_2" },
        { type: "function_call_output", output: "ok2" }, // missing
      ],
      tools: [
        { type: "function", name: "t1", parameters: { type: "object", properties: {} } },
        { type: "function", name: "t2", parameters: { type: "object", properties: {} } },
      ],
    };

    const result = openaiResponsesToOpenAIRequest("model", body, false, null);
    const toolMsgs = result.messages.filter(m => m.role === "tool");
    expect(toolMsgs.length).toBe(2);
    expect(toolMsgs[0].tool_call_id).toBeDefined();
    expect(toolMsgs[1].tool_call_id).toBeDefined();
    expect(toolMsgs[0].tool_call_id).not.toBe(toolMsgs[1].tool_call_id);
  });

  it("ensureToolCallIds repairs absent tool_call_id in tool messages", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", content: "result", tool_call_id: undefined }, // absent
        { role: "tool", content: "result2" }, // completely missing key
      ]
    };

    const result = ensureToolCallIds(body);
    expect(result.messages[1].tool_call_id).toBeDefined();
    expect(result.messages[1].tool_call_id).toMatch(/^call_/);
    expect(result.messages[2].tool_call_id).toBeDefined();
    expect(result.messages[2].tool_call_id).toMatch(/^call_/);
  });

  it("function_call with missing call_id gets deterministic id", async () => {
    const body = {
      model: "test-model",
      input: [
        { type: "message", role: "user", content: [ { type: "input_text", text: "hi" } ] },
        { type: "function_call", name: "exec", arguments: "{}" }, // MISSING call_id
      ],
      tools: [{ type: "function", name: "exec", parameters: { type: "object", properties: {} } }],
    };

    const result = openaiResponsesToOpenAIRequest("model", body, false, null);
    const asstMsg = result.messages.find(m => m.role === "assistant" && m.tool_calls?.length);
    expect(asstMsg).toBeDefined();
    expect(asstMsg.tool_calls[0].id).toBeDefined();
    expect(asstMsg.tool_calls[0].id).toMatch(/^call_/);
  });

  it("orphan function_call_output with no preceding call gets unique id and does not crash", async () => {
    const body = {
      model: "test-model",
      input: [
        { type: "message", role: "user", content: [ { type: "input_text", text: "hi" } ] },
        { type: "function_call_output", output: "orphan" }, // no preceding call
      ],
      tools: [],
    };

    const result = openaiResponsesToOpenAIRequest("model", body, false, null);
    const toolMsg = result.messages.find(m => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBeDefined();
    expect(toolMsg.tool_call_id).toMatch(/^call_/);
  });
});
