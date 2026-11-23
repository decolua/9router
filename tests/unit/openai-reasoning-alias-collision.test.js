import { describe, expect, it } from "vitest";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

describe("OpenAI assistant reasoning aliases (#4841)", () => {
  it("keeps canonical reasoning on replayed tool calls without modifying the source message", () => {
    const message = {
      role: "assistant",
      content: null,
      reasoning: "alias reasoning",
      reasoning_content: "canonical reasoning",
      tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
      name: "agent",
    };
    const body = {
      model: "glm-5.3",
      messages: [message, { role: "tool", tool_call_id: "c1", content: "result" }],
      stream: true,
    };

    const result = filterToOpenAIFormat(body);

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: null,
      reasoning_content: "canonical reasoning",
      tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
      name: "agent",
    });
    expect(result.messages[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "result" });
    expect(result.model).toBe("glm-5.3");
    expect(result.stream).toBe(true);
    expect(message.reasoning).toBe("alias reasoning");
  });

  it.each([{ content: "answer" }, { content: [{ type: "text", text: "answer" }] }])(
    "removes the string alias before normalizing assistant content %j",
    ({ content }) => {
      const result = filterToOpenAIFormat({ messages: [{
        role: "assistant", content, reasoning: "alias", reasoning_content: "canonical",
      }] });

      expect(result.messages[0]).not.toHaveProperty("reasoning");
      expect(result.messages[0].reasoning_content).toBe("canonical");
      expect(result.messages[0].content).toEqual(content);
    },
  );

  it.each(["", null])("retains an explicitly supplied canonical value %j", (canonical) => {
    const result = filterToOpenAIFormat({ messages: [{
      role: "assistant", content: "answer", reasoning: "alias", reasoning_content: canonical,
    }] });

    expect(result.messages[0]).not.toHaveProperty("reasoning");
    expect(result.messages[0].reasoning_content).toBe(canonical);
  });

  it.each([
    { reasoning: "alias only" },
    { reasoning: "alias only", reasoning_content: undefined },
    { reasoning_content: "canonical only" },
    { reasoning: { effort: "high" }, reasoning_content: "canonical" },
    { reasoning: [{ type: "text", text: "structured reasoning" }], reasoning_content: "canonical" },
  ])("preserves reasoning without a string alias collision: %j", (fields) => {
    const message = { role: "assistant", content: "answer", ...fields };
    const expected = structuredClone(message);
    const result = filterToOpenAIFormat({ messages: [message] });

    expect(result.messages[0]).toEqual(expected);
  });
});
