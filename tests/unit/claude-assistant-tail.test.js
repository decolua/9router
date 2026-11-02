import { describe, it, expect } from "vitest";
import { normalizeClaudeAssistantTail as normalize } from "../../open-sse/translator/concerns/claudeAssistantTail.js";

const text = (text) => ({ type: "text", text });
const request = (content) => ({ messages: [
  { role: "user", content: "question  " },
  { role: "assistant", content: "prior  \n" },
  { role: "user", content: "continue  " },
  { role: "assistant", content },
] });
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

describe("Claude final assistant whitespace", () => {
  it.each(["answer  ", "answer\n\t", "answer\r\n", "answer\u00a0"])("trims only the suffix of %j", (tail) => {
    const input = freeze(request("  lead\ninside " + tail));
    const result = normalize(input);
    expect(result.messages.at(-1).content).toBe("  lead\ninside answer");
    expect(result.messages.slice(0, -1)).toEqual(input.messages.slice(0, -1));
    expect(input.messages.at(-1).content).toBe("  lead\ninside " + tail);
    expect(normalize(result)).toBe(result);
  });

  it("removes blank suffix blocks, retaining internal text and metadata", () => {
    const input = freeze(request([text("internal  "), { ...text("end \n"), cache_control: { type: "ephemeral" } }, text(" "), text("\n")]));
    const result = normalize(input);
    expect(result.messages.at(-1).content).toEqual([text("internal  "), { ...text("end"), cache_control: { type: "ephemeral" } }]);
    expect(normalize(result)).toBe(result);
  });

  it.each([" \n", "", [], [text(""), text(" ")]])("drops an empty prefill %j", (content) => {
    const input = freeze(request(content));
    expect(normalize(input).messages).toEqual(input.messages.slice(0, -1));
  });

  it("checks assistant text exposed by removing an empty assistant tail", () => {
    const input = freeze({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "end  " }, { role: "assistant", content: "  " }] });
    expect(normalize(input).messages.at(-1).content).toBe("end");
  });

  it.each([
    { type: "tool_use", id: "toolu_1", name: "run", input: { code: "keep  \n" } },
    { type: "image", source: { type: "base64", data: "data  " } },
    { type: "thinking", thinking: "thought  ", signature: "signed  " },
    { type: "redacted_thinking", data: "signed  " },
  ])("preserves non-text boundary %j", (block) => {
    const input = freeze(request([text("internal  "), block, text(" ")]));
    const result = normalize(input);
    expect(result.messages.at(-1).content).toEqual([text("internal  "), block]);
    expect(result.messages.at(-1).content[1]).toBe(block);
    expect(normalize(result)).toBe(result);
  });

  it("does not touch an earlier assistant or a final user turn", () => {
    const input = freeze({ messages: [{ role: "assistant", content: "keep  " }, { role: "user", content: "keep  " }] });
    expect(normalize(input)).toBe(input);
  });

  it.each([{}, { messages: [] }, request("done"), request(null)])("leaves already normalized or unknown shapes alone", (input) => {
    expect(normalize(freeze(input))).toBe(input);
  });
});
