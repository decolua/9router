import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

describe("Antigravity tool translation", () => {
  it("normalizes schema constraints only where they are safe nonnegative integers", () => {
    const parameters = {
      type: "OBJECT",
      properties: {
        minLength: { type: "STRING", minLength: "1", maxLength: "9007199254740992" },
        records: { type: "ARRAY", minItems: "0", maxItems: "3", items: { type: "STRING", maxLength: "5" } },
      },
      anyOf: [{ type: "OBJECT", minProperties: "2" }, { type: "STRING", maxLength: "-1" }],
      additionalProperties: { type: "STRING", maxLength: "1.5" },
      enumDescriptions: ["unsupported"],
    };
    const body = { request: { tools: [{ functionDeclarations: [{ name: "lookup", parameters }] }] } };
    const schema = antigravityToOpenAIRequest("model", body, false).tools[0].function.parameters;
    expect(schema).toEqual({
      type: "object",
      properties: {
        minLength: { type: "string", minLength: 1, maxLength: "9007199254740992" },
        records: { type: "array", minItems: 0, maxItems: 3, items: { type: "string", maxLength: 5 } },
      },
      anyOf: [{ type: "object", minProperties: 2 }, { type: "string", maxLength: "-1" }],
      additionalProperties: { type: "string", maxLength: "1.5" },
    });
    expect(parameters.properties.minLength.minLength).toBe("1");
  });

  it("preserves parallel call IDs and falsy results across a round trip", () => {
    const state = {};
    openaiToAntigravityResponse({ choices: [{ delta: { tool_calls: [
      { index: 0, id: "call-first", function: { name: "lookup", arguments: '{"n":' } },
      { index: 1, id: "call-second", function: { name: "lookup", arguments: '{"n":2}' } },
    ] } }] }, state);
    const out = openaiToAntigravityResponse({ choices: [{ delta: { tool_calls: [
      { index: 0, function: { arguments: "1}" } },
    ] }, finish_reason: "tool_calls" }] }, state);
    const calls = out.response.candidates[0].content.parts.map((part) => part.functionCall);
    expect(calls).toEqual([
      { id: "call-first", name: "lookup", args: { n: 1 } },
      { id: "call-second", name: "lookup", args: { n: 2 } },
    ]);

    for (const result of [false, 0, "", null]) {
      const request = { request: { contents: [
        { role: "model", parts: calls.map((functionCall) => ({ functionCall })) },
        { role: "user", parts: calls.map(({ id, name }) => ({ functionResponse: { id, name, response: { result } } })) },
      ] } };
      const messages = antigravityToOpenAIRequest("model", request, false).messages;
      expect(messages[0].tool_calls.map((call) => call.id)).toEqual(["call-first", "call-second"]);
      expect(messages.slice(1).map((message) => [message.tool_call_id, message.content])).toEqual([
        ["call-first", JSON.stringify(result)], ["call-second", JSON.stringify(result)],
      ]);
    }
  });
});
