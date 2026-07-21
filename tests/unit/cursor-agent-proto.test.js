import { describe, expect, it } from "vitest";
import {
  decodeMessage,
  encodeField,
  encodeAgentValue,
  decodeAgentValue,
  encodeMcpToolDefinition,
  encodeMcpTools,
  decodeMcpArgs,
  encodeMcpResultSuccess,
  encodeMcpResultError,
  encodeMcpResultToolNotFound,
} from "../../open-sse/utils/cursorProtobuf.js";
import {
  isAgentCapableRequest,
  buildAgentRunFrame,
} from "../../open-sse/executors/cursor.js";

// AgentService (agent.v1) codec tests — validate the production implementation
// in cursorProtobuf.js + the executor's frame builders. Pure round-trip, no network.
// Field numbers verified against Cursor's agent.proto (extracted via @oh-my-pi).

const LEN = 2;
// McpArgs.args map entry { field1: key, field2: Value }
const entry = (k, v) => Buffer.concat([
  Buffer.from(encodeField(2, LEN,
    Buffer.concat([Buffer.from(encodeField(1, LEN, k)), Buffer.from(encodeField(2, LEN, encodeAgentValue(v)))])
  )),
]);

describe("Cursor AgentService codec (cursorProtobuf.js)", () => {
  describe("google.protobuf.Value round-trip", () => {
    const cases = [
      ["null", null],
      ["bool true", true],
      ["bool false", false],
      ["string", "hello"],
      ["integer", 42],
      ["float", 3.14],
      ["empty object", {}],
      ["flat object", { a: 1, b: "x", c: true }],
      ["nested object", { outer: { inner: [1, 2, "three"] } }],
      ["array of mixed", [1, "two", false, null]],
      ["deeply nested", { a: { b: { c: { d: 1 } } } }],
    ];
    for (const [label, value] of cases) {
      it(`encodes/decodes ${label}`, () => {
        expect(decodeAgentValue(encodeAgentValue(value))).toEqual(value);
      });
    }
  });

  describe("McpToolDefinition", () => {
    it("encodes name, description, input_schema (Value), provider, tool_name", () => {
      const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] };
      const def = encodeMcpToolDefinition({ function: { name: "get_weather", description: "Get weather", parameters: schema } });
      const msg = decodeMessage(def);
      expect(Buffer.from(msg.get(1)[0].value).toString("utf8")).toBe("get_weather");
      expect(Buffer.from(msg.get(2)[0].value).toString("utf8")).toBe("Get weather");
      expect(Buffer.from(msg.get(4)[0].value).toString("utf8")).toBe("9router");
      expect(Buffer.from(msg.get(5)[0].value).toString("utf8")).toBe("get_weather");
      expect(decodeAgentValue(msg.get(3)[0].value)).toEqual(schema);
    });

    it("preserves nested JSON-schema types", () => {
      const schema = {
        type: "object",
        properties: {
          query: { type: "string", description: "search query" },
          opts: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      };
      const def = encodeMcpToolDefinition({ function: { name: "search", parameters: schema } });
      const msg = decodeMessage(def);
      expect(decodeAgentValue(msg.get(3)[0].value)).toEqual(schema);
    });

    it("accepts flat tool shape (no .function wrapper)", () => {
      const def = encodeMcpToolDefinition({ name: "noop", description: "d", inputSchema: { type: "object" } });
      const msg = decodeMessage(def);
      expect(Buffer.from(msg.get(1)[0].value).toString("utf8")).toBe("noop");
    });
  });

  describe("encodeMcpTools", () => {
    it("produces empty bytes for no tools", () => {
      expect(encodeMcpTools([]).length).toBe(0);
      expect(encodeMcpTools().length).toBe(0);
    });

    it("wraps multiple tool defs as repeated field 1", () => {
      const tools = [
        { function: { name: "get_weather", parameters: { type: "object" } } },
        { function: { name: "calculate", parameters: { type: "object" } } },
      ];
      const mcpTools = encodeMcpTools(tools);
      const inner = decodeMessage(mcpTools);
      expect(inner.get(1).length).toBe(2);
    });
  });

  describe("McpArgs decode", () => {
    it("decodes name, toolName, toolCallId, and typed args map", () => {
      const argsBytes = Buffer.concat([
        entry("city", "Hanoi"),
        entry("count", 5),
        entry("flag", true),
        entry("nested", { a: [1, 2] }),
      ]);
      const mcpArgs = Buffer.concat([
        Buffer.from(encodeField(1, LEN, "get_weather")),
        argsBytes,
        Buffer.from(encodeField(3, LEN, "call_abc")),
        Buffer.from(encodeField(5, LEN, "get_weather")),
      ]);
      const decoded = decodeMcpArgs(mcpArgs);
      expect(decoded.name).toBe("get_weather");
      expect(decoded.toolName).toBe("get_weather");
      expect(decoded.toolCallId).toBe("call_abc");
      expect(decoded.args).toEqual({ city: "Hanoi", count: 5, flag: true, nested: { a: [1, 2] } });
    });

    it("handles empty args map", () => {
      const mcpArgs = Buffer.concat([
        Buffer.from(encodeField(1, LEN, "noop")),
        Buffer.from(encodeField(5, LEN, "noop")),
      ]);
      expect(decodeMcpArgs(mcpArgs).args).toEqual({});
    });
  });

  describe("McpResult success", () => {
    it("builds success with single text content", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ['{"temp":32}'], isError: false });
      const msg = decodeMessage(bytes); // McpResult level
      expect(msg.has(1)).toBe(true); // success variant
      const success = decodeMessage(msg.get(1)[0].value);
      expect(success.get(1).length).toBe(1);
      expect(success.get(2)[0].value).toBe(0); // is_error=false
      const item = decodeMessage(success.get(1)[0].value);
      const textContent = decodeMessage(item.get(1)[0].value);
      expect(Buffer.from(textContent.get(1)[0].value).toString("utf8")).toBe('{"temp":32}');
    });

    it("builds success with multiple text items", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ["line1", "line2"] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(1).length).toBe(2);
    });

    it("marks is_error=true", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ["fail"], isError: true });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(2)[0].value).toBe(1);
    });
  });

  describe("McpResult image content", () => {
    it("builds image item with raw bytes + mime type", () => {
      const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const bytes = encodeMcpResultSuccess({ imageItems: [{ data: imgBytes, mimeType: "image/png" }] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      const item = decodeMessage(success.get(1)[0].value);
      expect(item.has(2)).toBe(true); // image variant
      const img = decodeMessage(item.get(2)[0].value);
      expect(Buffer.from(img.get(1)[0].value)).toEqual(Buffer.from(imgBytes));
      expect(Buffer.from(img.get(2)[0].value).toString("utf8")).toBe("image/png");
    });

    it("builds mixed text + image content", () => {
      const imgBytes = new Uint8Array([1, 2, 3]);
      const bytes = encodeMcpResultSuccess({ textItems: ["see image"], imageItems: [{ data: imgBytes, mimeType: "image/jpeg" }] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(1).length).toBe(2);
      expect(decodeMessage(success.get(1)[0].value).has(1)).toBe(true); // text
      expect(decodeMessage(success.get(1)[1].value).has(2)).toBe(true); // image
    });
  });

  describe("McpResult error / toolNotFound", () => {
    it("builds error result (field 2)", () => {
      const bytes = encodeMcpResultError("tool crashed");
      const msg = decodeMessage(bytes);
      expect(msg.has(2)).toBe(true);
      const err = decodeMessage(msg.get(2)[0].value);
      expect(Buffer.from(err.get(1)[0].value).toString("utf8")).toBe("tool crashed");
    });

    it("builds toolNotFound result (field 5)", () => {
      const bytes = encodeMcpResultToolNotFound("missing_tool");
      const msg = decodeMessage(bytes);
      expect(msg.has(5)).toBe(true);
      const tnf = decodeMessage(msg.get(5)[0].value);
      expect(Buffer.from(tnf.get(1)[0].value).toString("utf8")).toBe("missing_tool");
    });
  });
});

describe("Cursor AgentService executor helpers (cursor.js)", () => {
  describe("isAgentCapableRequest", () => {
    it("accepts plain text content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: "hi" }] })).toBe(true);
    });

    it("accepts array text content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })).toBe(true);
    });

    it("accepts request with tools declared", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: "hi" }], tools: [{ function: { name: "t" } }] })).toBe(true);
    });

    it("accepts history with assistant tool_calls + tool results", () => {
      expect(isAgentCapableRequest({
        messages: [
          { role: "user", content: "weather?" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: "sunny" },
          { role: "user", content: "thanks" },
        ],
      })).toBe(true);
    });

    it("rejects non-text (image) content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: [{ type: "image_url" }] }] })).toBe(false);
    });

    it("rejects missing messages", () => {
      expect(isAgentCapableRequest({})).toBe(false);
      expect(isAgentCapableRequest(null)).toBe(false);
    });
  });

  describe("buildAgentRunFrame", () => {
    // buildAgentRunFrame returns a wrapped Connect-RPC frame (5-byte header + AgentClientMessage).
    const unwrap = (frame) => frame.subarray(5);

    it("encodes a text-only run request with system + model", () => {
      const frame = unwrap(buildAgentRunFrame(
        [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
        "gpt-5.2",
      ));
      const clientMsg = decodeMessage(frame);
      expect(clientMsg.has(1)).toBe(true); // run_request
      const run = decodeMessage(clientMsg.get(1)[0].value);
      expect(run.has(2)).toBe(true); // action
      expect(run.has(9)).toBe(true); // requested_model
    });

    it("encodes mcp_tools (field 4) when tools are provided", () => {
      const tools = [{ function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
      const frame = unwrap(buildAgentRunFrame([{ role: "user", content: "weather?" }], "gpt-5.2", tools));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      expect(run.has(4)).toBe(true); // mcp_tools
      const mcpTools = decodeMessage(run.get(4)[0].value);
      expect(mcpTools.get(1).length).toBe(1);
    });

    it("omits mcp_tools when no tools provided", () => {
      const frame = unwrap(buildAgentRunFrame([{ role: "user", content: "hi" }], "gpt-5.2", []));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      expect(run.has(4)).toBe(false);
    });

    it("encodes conversation_history from prior turns including tool calls/results", () => {
      const messages = [
        { role: "user", content: "weather in Tokyo?" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } }] },
        { role: "tool", tool_call_id: "c1", content: "18C cloudy" },
        { role: "user", content: "thanks" },
      ];
      const frame = unwrap(buildAgentRunFrame(messages, "gpt-5.2", []));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      const action = decodeMessage(run.get(2)[0].value);
      const userAction = decodeMessage(action.get(1)[0].value);
      expect(userAction.has(7)).toBe(true); // conversation_history (field 7)
      const history = decodeMessage(userAction.get(7)[0].value);
      expect(history.get(1).length).toBeGreaterThanOrEqual(2); // prior turns
    });
  });
});
