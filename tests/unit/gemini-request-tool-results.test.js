import { describe, expect, it } from "vitest";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";

const response = (name, result, id) => ({ functionResponse: { name, response: { result }, ...(id ? { id } : {}) } });
const convert = (parts, role = "user") => geminiToOpenAIRequest("test-model", {
  contents: [{ role, parts }],
}, false).messages;

describe("Gemini request tool results (#2393)", () => {
  it("keeps one tool result with the existing fallback call id", () => {
    expect(convert([response("read", "file contents")])).toEqual([
      { role: "tool", tool_call_id: "call_read", content: '"file contents"' },
    ]);
  });

  it("keeps every parallel tool result in source order with explicit ids", () => {
    expect(convert([response("read", "first", "c1"), response("search", "second", "c2")])).toEqual([
      { role: "tool", tool_call_id: "c1", content: '"first"' },
      { role: "tool", tool_call_id: "c2", content: '"second"' },
    ]);
  });

  it.each(["user", "model"])("keeps co-located text with its original %s role", (role) => {
    expect(convert([{ text: "before" }, response("read", "done"), { text: "after" }], role)).toEqual([
      { role: "tool", tool_call_id: "call_read", content: '"done"' },
      { role: role === "model" ? "assistant" : "user", content: [
        { type: "text", text: "before" }, { type: "text", text: "after" },
      ] },
    ]);
  });

  it("keeps calls and text around a tool result", () => {
    expect(convert([
      { functionCall: { id: "c2", name: "next", args: { path: "a.txt" } } },
      response("previous", "done", "c1"),
      { text: "continuing" },
      { functionCall: { name: "last", args: {} } },
    ], "model")).toEqual([
      { role: "tool", tool_call_id: "c1", content: '"done"' },
      { role: "assistant", content: "continuing", tool_calls: [
        { id: "c2", type: "function", function: { name: "next", arguments: '{"path":"a.txt"}' } },
        { id: "call_last", type: "function", function: { name: "last", arguments: "{}" } },
      ] },
    ]);
  });

  it("flattens converted results without reordering following content turns", () => {
    const out = geminiToOpenAIRequest("test-model", { contents: [
      { role: "user", parts: [response("one", "1"), response("two", "2")] },
      { role: "user", parts: [{ text: "follow up" }] },
    ] }, true);
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "call_one", content: '"1"' },
      { role: "tool", tool_call_id: "call_two", content: '"2"' },
      { role: "user", content: "follow up" },
    ]);
    expect(out.stream).toBe(true);
  });

  it("keeps ordinary text-only content", () => {
    expect(convert([{ text: "hello" }])).toEqual([{ role: "user", content: "hello" }]);
  });

  it("does not add messages for empty contents", () => {
    expect(convert([])).toEqual([]);
  });
});
