// Antigravity (Gemini upstream) rejects the whole request when a thinking
// block carries no signature:
//   messages.1.content.0.thinking.signature: Field required
//
// The DEEP combo mixes anti/claude-* and anti/gemini-* in one rotation, so a
// Claude-signed block routinely reaches Gemini. Antigravity's provider string is
// `openai-compatible-chat-*` and never equals "claude", so the previous
// `provider === "claude"` branch never matched and every thinking block fell
// into the default-signature fallback, which Gemini then refused.
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const ANTI = "openai-compatible-chat-ce741e14";
const ANTI_2 = "openai-compatible-chat-cd87d063";
const CLAUDE_SIG = "EpwGCkYICh" + "A".repeat(40); // E-form Claude signature
const GEMINI_SIG = "CtUB3dGh" + "B".repeat(40);

const body = (content, opts = {}) => ({
  model: opts.model || "anti/gemini-3.8-flash-high",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 1024 },
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content },
    // A placeholder is only inserted when the last turn is a user turn.
    ...(opts.trailingUser ? [{ role: "user", content: "continue" }] : []),
  ],
});

const thinkingOf = (out, i = 1) =>
  out.messages[i].content.filter((b) => b.type === "thinking");

describe("Antigravity thinking signature handling", () => {
  it("drops a thinking block whose signature is empty", () => {
    const out = prepareClaudeRequest(
      body([{ type: "thinking", thinking: "hmm", signature: "" }]),
      ANTI
    );
    expect(thinkingOf(out)).toHaveLength(0);
  });

  it("drops a thinking block whose signature is missing entirely", () => {
    const out = prepareClaudeRequest(
      body([{ type: "thinking", thinking: "hmm" }]),
      ANTI
    );
    expect(thinkingOf(out)).toHaveLength(0);
  });

  it("keeps a thinking block that carries a signature, unchanged", () => {
    const out = prepareClaudeRequest(
      body([{ type: "thinking", thinking: "hmm", signature: GEMINI_SIG }]),
      ANTI
    );
    const kept = thinkingOf(out);
    expect(kept).toHaveLength(1);
    expect(kept[0].signature).toBe(GEMINI_SIG);
  });

  it("does not inject a placeholder thinking block", () => {
    // A fabricated signature is exactly what Gemini rejects, so inserting one
    // only trades this failure for the same one.
    const out = prepareClaudeRequest(
      body(
        [
          { type: "thinking", thinking: "hmm", signature: "" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
        { trailingUser: true }
      ),
      ANTI
    );
    expect(thinkingOf(out)).toHaveLength(0);
  });

  it("keeps the signed block when the history mixes both formats", () => {
    const out = prepareClaudeRequest(
      body([
        { type: "thinking", thinking: "a", signature: CLAUDE_SIG },
        { type: "text", text: "answer" },
      ]),
      ANTI
    );
    const kept = thinkingOf(out);
    expect(kept).toHaveLength(1);
    expect(kept[0].signature).toBe(CLAUDE_SIG);
  });

  it("applies to both Antigravity connections", () => {
    for (const provider of [ANTI, ANTI_2]) {
      const out = prepareClaudeRequest(
        body([{ type: "thinking", thinking: "hmm", signature: "" }]),
        provider
      );
      expect(thinkingOf(out), provider).toHaveLength(0);
    }
  });

  it("leaves the Claude provider path unchanged", () => {
    const out = prepareClaudeRequest(
      body(
        [
          { type: "text", text: "x" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
        { trailingUser: true, model: "claude-opus-4-5" }
      ),
      "claude"
    );
    const ph = thinkingOf(out)[0];
    expect(ph, "claude still gets a signed placeholder").toBeTruthy();
    expect(ph.signature).toBeTruthy();
  });

  it("leaves the anthropic-compatible path unchanged", () => {
    const out = prepareClaudeRequest(
      body(
        [
          { type: "text", text: "x" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
        { trailingUser: true }
      ),
      "anthropic-compatible-abc"
    );
    const ph = thinkingOf(out)[0];
    expect(ph).toBeTruthy();
    expect(ph.signature).toBeTruthy();
  });
});