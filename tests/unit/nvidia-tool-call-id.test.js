import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { normalizeOpenAIToolNames, normalizeNvidiaToolCallIds, nvidiaToolCallId } from "../../open-sse/translator/concerns/toolCall.js";

describe("NVIDIA tool call IDs", () => {
  it("preserves valid 9-character alphanumeric IDs", () => {
    const validId = "a1b2c3d4e";
    expect(nvidiaToolCallId(validId)).toBe(validId);

    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ id: validId, type: "function", function: { name: "test", arguments: "{}" } }] },
        { role: "tool", tool_call_id: validId, content: "ok" },
      ],
    };
    normalizeNvidiaToolCallIds(body);

    expect(body.messages[0].tool_calls[0].id).toBe(validId);
    expect(body.messages[1].tool_call_id).toBe(validId);
  });

  it("normalizes invalid IDs to 9-character alphanumeric strings", () => {
    const invalidId = "invalid-id-with-dashes-and-long-length-12345";
    const normalized = nvidiaToolCallId(invalidId);

    expect(normalized).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(normalized).not.toBe(invalidId);
  });

  it("generates and normalizes missing tool call IDs", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ function: { name: "get_weather", arguments: "{}" } }] },
      ],
    };
    normalizeNvidiaToolCallIds(body);

    expect(body.messages[0].tool_calls[0].id).toMatch(/^[a-zA-Z0-9]{9}$/);
  });

  it("handles two missing IDs in one request without collision", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { function: { name: "get_weather", arguments: "{}" } },
            { function: { name: "get_stock", arguments: "{}" } },
          ],
        },
      ],
    };
    normalizeNvidiaToolCallIds(body);

    const id1 = body.messages[0].tool_calls[0].id;
    const id2 = body.messages[0].tool_calls[1].id;

    expect(id1).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(id2).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(id1).not.toBe(id2);
  });

  it("normalizes multiple tool calls without collisions", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call_abc_1", function: { name: "fn1", arguments: "{}" } },
            { id: "call_abc_2", function: { name: "fn2", arguments: "{}" } },
            { id: "call_abc_3", function: { name: "fn3", arguments: "{}" } },
          ],
        },
      ],
    };
    normalizeNvidiaToolCallIds(body);

    const ids = body.messages[0].tool_calls.map((tc) => tc.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(/^[a-zA-Z0-9]{9}$/));
  });

  it("maintains consistency between assistant tool_calls[].id and tool-result tool_call_id", () => {
    const originalId = "6075034-0";
    const out = new DefaultExecutor("nvidia").transformRequest("mistralai/mistral-medium-3.5-128b", {
      messages: [
        { role: "assistant", tool_calls: [{ id: originalId, type: "function", function: { name: "test", arguments: "{}" } }] },
        { role: "tool", tool_call_id: originalId, content: "ok" },
      ],
    });

    expect(out.messages[0].tool_calls[0].id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(out.messages[1].tool_call_id).toBe(out.messages[0].tool_calls[0].id);
  });

  it("is idempotent over repeated normalization passes", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ id: "call_test_12345", function: { name: "test", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_test_12345", content: "result" },
      ],
    };

    normalizeNvidiaToolCallIds(body);
    const idPass1 = body.messages[0].tool_calls[0].id;
    const toolIdPass1 = body.messages[1].tool_call_id;

    normalizeNvidiaToolCallIds(body);
    const idPass2 = body.messages[0].tool_calls[0].id;
    const toolIdPass2 = body.messages[1].tool_call_id;

    expect(idPass1).toBe(idPass2);
    expect(toolIdPass1).toBe(toolIdPass2);
  });

  it("coexists seamlessly with tool-name normalization", () => {
    const longToolName = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message";
    const body = {
      tools: [{ type: "function", function: { name: longToolName } }],
      messages: [
        { role: "assistant", tool_calls: [{ id: "call_long_tool_1", function: { name: longToolName, arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_long_tool_1", content: "ok" },
      ],
    };

    normalizeOpenAIToolNames(body, 64);
    normalizeNvidiaToolCallIds(body);

    expect(body.tools[0].function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(body.messages[0].tool_calls[0].function.name).toBe(body.tools[0].function.name);
    expect(body.messages[0].tool_calls[0].id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(body.messages[1].tool_call_id).toBe(body.messages[0].tool_calls[0].id);
  });
});
