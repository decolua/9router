import { describe, expect, it } from "vitest";

import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";

function normalize(argumentsValue, includeArguments = true) {
  const fn = { name: "probe_tool" };
  if (includeArguments) fn.arguments = argumentsValue;
  const body = {
    messages: [{
      role: "assistant",
      tool_calls: [{ id: "call_probe", type: "function", function: fn }],
    }],
  };

  ensureToolCallIds(body);
  return body.messages[0].tool_calls[0].function;
}

describe("ensureToolCallIds function arguments", () => {
  it.each([
    ["missing", undefined, false],
    ["undefined", undefined, true],
    ["null", null, true],
    ["empty", "", true],
  ])("normalizes %s arguments to an empty JSON object", (_label, value, include) => {
    expect(normalize(value, include).arguments).toBe("{}");
  });

  it("serializes object arguments", () => {
    expect(normalize({ query: "nine router" }).arguments).toBe('{"query":"nine router"}');
  });

  it("preserves a non-empty argument string", () => {
    expect(normalize('{"query":"nine router"}').arguments).toBe('{"query":"nine router"}');
  });

  it("does not fabricate a missing function object", () => {
    const body = {
      messages: [{
        role: "assistant",
        tool_calls: [{ id: "call_probe", type: "function" }],
      }],
    };

    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function).toBeUndefined();
  });
});
