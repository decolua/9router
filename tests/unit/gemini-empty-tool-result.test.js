import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("openai -> gemini empty tool result", () => {
  it("preserves an empty-string tool response", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" }
            }
          ]
        },
        { role: "tool", tool_call_id: "call_1", content: "" }
      ]
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-3.6-flash",
      body,
      true,
      null,
      "gemini"
    );

    expect(result.contents[1].parts[0].functionResponse).toMatchObject({
      id: "call_1",
      name: "lookup"
    });
  });
});
