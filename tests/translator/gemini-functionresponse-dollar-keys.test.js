// OpenAI → Gemini: tool results containing literal "$ref"/"$defs" keys as plain
// payload data (e.g. a fetched JSON Schema document) must not reach Gemini
// unchanged — Gemini's function_response parser treats those keys as schema
// references and rejects the whole request if it can't resolve them.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");

describe("OpenAI → Gemini: functionResponse $-prefixed keys", () => {
  it("renames $ref/$defs keys inside a tool result instead of passing them through", () => {
    const out = O2G({
      messages: [
        { role: "user", content: "read schema.json" },
        {
          role: "assistant",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: JSON.stringify({ $ref: "#/definitions/User", nested: { $defs: { x: 1 } } }),
        },
      ],
    });

    const part = out.contents.flatMap((c) => c.parts || []).find((p) => p.functionResponse);
    const result = part.functionResponse.response.result;

    expect(JSON.stringify(result)).not.toContain('"$ref"');
    expect(JSON.stringify(result)).not.toContain('"$defs"');
    expect(result._ref).toBe("#/definitions/User");
    expect(result.nested._defs.x).toBe(1);
  });
});
