// filterToOpenAIFormat treated `tool_calls: []` as "this message carries tool calls",
// because an empty array is truthy. Two shortcuts keyed off that check, so an assistant
// message with an empty tool_calls array skipped content normalisation and survived the
// empty-message filter. Upstreams that reject Claude-only blocks or empty assistant turns
// then rejected the whole request.
import { describe, it, expect } from "vitest";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

describe("filterToOpenAIFormat with an empty tool_calls array", () => {
  it("still strips Claude-only blocks from the assistant turn", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [],
          content: [
            { type: "thinking", thinking: "internal reasoning" },
            { type: "text", text: "visible answer" },
          ],
        },
      ],
    };

    const out = filterToOpenAIFormat(body);
    const types = out.messages[0].content.map((b) => b.type);

    expect(types).not.toContain("thinking");
    expect(types).toEqual(["text"]);
  });

  it("still drops an assistant turn left with no usable content", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", tool_calls: [], content: "   " },
      ],
    };

    const out = filterToOpenAIFormat(body);

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });

  it("leaves a message with real tool calls untouched", () => {
    const toolCall = {
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: "{}" },
    };
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [toolCall],
          content: [{ type: "thinking", thinking: "keep me" }],
        },
      ],
    };

    const out = filterToOpenAIFormat(body);

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].tool_calls).toEqual([toolCall]);
    expect(out.messages[0].content).toEqual([{ type: "thinking", thinking: "keep me" }]);
  });
});
