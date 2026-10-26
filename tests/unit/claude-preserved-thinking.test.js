/**
 * Passthrough to first-party Anthropic must send assistant turns back
 * unchanged — blank-text `thinking` (valid signature) and `redacted_thinking`
 * included — while foreign blocks are still removed (part of #5184).
 *
 * Live-traffic evidence: the first-party API accepts blank-text blocks with
 * their original signatures; dropping them silently loses earlier reasoning
 * on every turn, and partially dropping a turn's thinking risks a 400.
 */
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE as E_SIG } from "../../open-sse/config/defaultThinkingSignature.js";

const body = (thinkingBlock) => ({
  model: "claude-opus-5-5",
  thinking: { type: "adaptive", display: "updates" },
  messages: [
    { role: "user", content: "list the files" },
    {
      role: "assistant",
      content: [
        thinkingBlock,
        { type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "ls" } },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "a.txt" }] },
  ],
});

describe("normalizeClaudePassthrough — preserved thinking (#5184)", () => {
  it("keeps a blank-text thinking block with a valid signature", () => {
    const out = normalizeClaudePassthrough(
      body({ type: "thinking", thinking: "", signature: E_SIG }),
      "claude-opus-5-5",
    );
    const types = out.messages[1].content.map((b) => b.type);
    expect(types).toContain("thinking");
    expect(types).toContain("tool_use");
  });

  it("keeps a redacted_thinking block (no signature to validate)", () => {
    const out = normalizeClaudePassthrough(
      body({ type: "redacted_thinking", data: "x" }),
      "claude-opus-5-5",
    );
    const types = out.messages[1].content.map((b) => b.type);
    expect(types).toContain("redacted_thinking");
    expect(types).toContain("tool_use");
  });

  it("still drops empty text blocks", () => {
    const out = normalizeClaudePassthrough(
      {
        model: "claude-opus-5-5",
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "   " },
              { type: "text", text: "real answer" },
            ],
          },
          { role: "user", content: "there?" },
        ],
      },
      "claude-opus-5-5",
    );
    expect(out.messages[1].content).toEqual([{ type: "text", text: "real answer" }]);
  });
});
