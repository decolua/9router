// A replayed assistant turn can carry a thinking block whose text is empty or
// whitespace-only while its signature is still valid — e.g. a thought that was
// stripped upstream, or a provider that streamed whitespace as reasoning. Both
// request paths that forward Claude history kept such blocks, and Anthropic
// rejects the whole request:
//   400 messages.N.content.0.thinking: each thinking block must contain non-whitespace thinking
//   - normalizeClaudePassthrough (native Claude passthrough clients) — signature check alone
//   - prepareClaudeRequest (translated clients; the deepSeekServed and
//     anthropic-compatible branches keep thinking unconditionally)
// Empty *text* blocks are already dropped for the same class of upstream 400;
// thinking blocks need the same treatment on both paths.
//
// The signature must be a REAL E-form one: an invalid signature is dropped earlier
// by the signature check, which would mask the text check under test.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

const assistant = (blocks) => ({ role: "assistant", content: blocks });
const thinking = (text) => ({ type: "thinking", thinking: text, signature: DEFAULT_THINKING_CLAUDE_SIGNATURE });

const claudeRequest = (messages) => ({
  model: "deepseek-v4.1-flash",
  max_tokens: 1024,
  messages,
});

describe("normalizeClaudePassthrough — blank thinking blocks", () => {
  it("drops an empty thinking block and keeps its sibling text block", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        assistant([thinking(""), { type: "text", text: "kept" }]),
      ],
    });

    expect(out.messages[1].content).toEqual([{ type: "text", text: "kept" }]);
  });

  it("drops a whitespace-only thinking block", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        assistant([thinking("  \n\t "), { type: "text", text: "kept" }]),
      ],
    });

    expect(out.messages[1].content).toEqual([{ type: "text", text: "kept" }]);
  });

  it("drops the whole message when the blank thinking block was its only content", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        assistant([thinking("   ")]),
      ],
    });

    expect(out.messages.some(m => m.role === "assistant")).toBe(false);
  });

  it("keeps a thinking block that has visible text", () => {
    const block = thinking("considered it");
    const out = normalizeClaudePassthrough({
      messages: [{ role: "user", content: "hi" }, assistant([block, { type: "text", text: "kept" }])],
    });

    expect(out.messages[1].content).toEqual([block, { type: "text", text: "kept" }]);
  });
});

// The translated path (CC → non-native provider over the Claude transport):
// prepareClaudeRequest's deepSeekServed branch keeps thinking unconditionally, so
// a blank block rode through to the upstream and 400'd the request.
describe("prepareClaudeRequest — blank thinking blocks (deepSeekServed via opencode-go)", () => {
  // prepareClaudeRequest also stamps cache_control on the last non-thinking block
  // of the final assistant, so assert on block kinds + thinking text, not deep equality.
  it("drops a blank thinking block but keeps its sibling text block", () => {
    const out = prepareClaudeRequest(claudeRequest([
      { role: "user", content: "hi" },
      assistant([thinking("   "), { type: "text", text: "kept" }]),
    ]), "opencode-go");

    const asst = out.messages.find(m => m.role === "assistant");
    expect(asst.content.map(b => b.type)).toEqual(["text"]);
    expect(asst.content[0].text).toBe("kept");
  });

  it("keeps a signed thinking block that has visible text (deepSeekServed keeps thinking)", () => {
    const block = thinking("considered it");
    const out = prepareClaudeRequest(claudeRequest([
      { role: "user", content: "hi" },
      assistant([block, { type: "text", text: "kept" }]),
    ]), "opencode-go");

    const asst = out.messages.find(m => m.role === "assistant");
    expect(asst.content.some(b => b.type === "thinking" && b.thinking === "considered it")).toBe(true);
    expect(asst.content.some(b => b.type === "text")).toBe(true);
  });

  it("drops a blank thinking block on the plain deepseek provider too", () => {
    const out = prepareClaudeRequest(claudeRequest([
      { role: "user", content: "hi" },
      assistant([thinking(""), { type: "text", text: "kept" }]),
    ]), "deepseek");

    const asst = out.messages.find(m => m.role === "assistant");
    expect(asst.content.map(b => b.type)).toEqual(["text"]);
    expect(asst.content[0].text).toBe("kept");
  });
});
