// Guards for malformed entries in ensureToolCallIds (#3764).
import { describe, it, expect } from "vitest";
import {
  ensureToolCallIds,
  generateToolCallId,
} from "../../open-sse/translator/concerns/toolCall.js";

describe("ensureToolCallIds — malformed entries", () => {
  it("skips null messages instead of throwing", () => {
    const body = { messages: [null, { role: "user", content: "hi" }] };
    expect(() => ensureToolCallIds(body)).not.toThrow();
  });

  it("skips null tool_calls entries instead of throwing", () => {
    const body = {
      messages: [{ role: "assistant", tool_calls: [null] }],
    };
    expect(() => ensureToolCallIds(body)).not.toThrow();
  });

  it("skips null content blocks instead of throwing", () => {
    const body = {
      messages: [{ role: "assistant", content: [null] }],
    };
    expect(() => ensureToolCallIds(body)).not.toThrow();
  });

  it("repairs numeric function names instead of throwing", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "!!!", function: { name: 123 } }],
        },
      ],
    };
    expect(() => ensureToolCallIds(body)).not.toThrow();
    expect(body.messages[0].tool_calls[0].id).toMatch(/^call_msg0_tc0/);
  });

  it("leaves well-formed bodies untouched", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } }],
        },
      ],
    };
    ensureToolCallIds(body);
    expect(body.messages[1].tool_calls[0].id).toBe("call_1");
  });
});

describe("generateToolCallId — non-string names", () => {
  it("ignores numeric names instead of throwing", () => {
    expect(generateToolCallId(0, 0, 123)).toBe("call_msg0_tc0");
  });
});
