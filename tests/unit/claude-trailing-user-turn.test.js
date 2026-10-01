// Anthropic rejects a body ending on an assistant turn ("This model does not support
// assistant message prefill"). Cleanup passes delete emptied messages, so an emptied
// trailing user turn used to leave the previous assistant turn last.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const roles = (body) => body.messages.map((m) => m.role);
const history = (last) => [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "text", text: "hello" }] },
  last,
];

const emptyLastTurns = {
  "empty string": { role: "user", content: "" },
  "blank text block": { role: "user", content: [{ type: "text", text: "  " }] },
  "empty content array": { role: "user", content: [] },
  "unsupported block only": { role: "user", content: [{ type: "search_result", source: "x", title: "t", content: [] }] },
};

describe("trailing user turn survives empty-message cleanup", () => {
  for (const [name, last] of Object.entries(emptyLastTurns)) {
    it(`prepareClaudeRequest: ${name}`, () => {
      const out = prepareClaudeRequest({ model: "claude-opus-4-5", max_tokens: 100, messages: history(last) }, "claude");
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
    it(`normalizeClaudePassthrough: ${name}`, () => {
      const out = normalizeClaudePassthrough({ model: "claude-opus-4-5", messages: history(last) }, "claude-opus-4-5");
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
  }

  it("passthrough: tool_result of a dropped foreign server_tool_use no longer empties the last turn into prefill", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-opus-4-5",
      messages: [
        { role: "user", content: "analyze" },
        { role: "assistant", content: [{ type: "server_tool_use", id: "call_abc", name: "analyze_image", input: {} }, { type: "text", text: "done" }] },
        { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "call_abc", content: [] }] },
      ],
    }, "claude-opus-4-5");
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });

  it("full pipeline: OpenAI client with an empty last user message", () => {
    const out = translateRequest("openai", "claude", "claude-opus-4-5", {
      model: "x", max_tokens: 100,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "" }],
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("full pipeline: Claude client with a blank last user block", () => {
    const out = translateRequest("claude", "claude", "claude-opus-4-5", {
      model: "x", max_tokens: 100, messages: history({ role: "user", content: [{ type: "text", text: "" }] }),
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("leaves intentional client prefill (last turn is assistant) untouched", () => {
    const body = { model: "claude-opus-4-5", max_tokens: 100, messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "Sure:" }] },
    ] };
    expect(roles(prepareClaudeRequest(structuredClone(body), "claude"))).toEqual(["user", "assistant"]);
    expect(roles(normalizeClaudePassthrough(structuredClone(body), "claude-opus-4-5"))).toEqual(["user", "assistant"]);
  });

  it("does not append anything when the last user turn has content", () => {
    const out = prepareClaudeRequest({ model: "claude-opus-4-5", max_tokens: 100, messages: history({ role: "user", content: "next" }) }, "claude");
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
    expect(out.messages.at(-1).content[0].text).toBe("next");
  });
});
