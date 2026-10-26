// Locks edge cases flagged in docs 11 §1/§4 that were only covered indirectly.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { parseDataUri, encodeDataUri } from "../../open-sse/translator/concerns/image.js";

describe("normalizeClaudePassthrough — haiku thinking + mid-conversation system (docs 11 §1)", () => {
  it("downgrades adaptive thinking to enabled+budget for haiku models", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-haiku-4-5");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("keeps adaptive thinking for sonnet/opus", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-sonnet-4-6");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  // normalizeClaudePassthrough folds a mid-conversation system message into the
  // preceding user turn instead of hoisting it (claude.js:239-271): hoisting would
  // move volatile content ahead of the conversation and invalidate the prefix cache
  // on every request. Text and turn order must survive the fold.
  it("folds mid-conversation system messages into the preceding user turn", () => {
    const out = normalizeClaudePassthrough({
      system: [{ type: "text", text: "stay terse" }],
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "more" },
      ],
    });
    // The leading system prompt stays top-level and is not rewritten by the fold.
    expect(out.system).toEqual([{ type: "text", text: "stay terse" }]);
    expect(out.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "be brief" },
        ],
      },
      { role: "assistant", content: "ok" },
      { role: "user", content: "more" },
    ]);
    expect(out.messages.every((m) => m.role !== "system")).toBe(true);
  });
});

describe("parseDataUri / encodeDataUri (docs 11 §4)", () => {
  it("parses a base64 data uri", () => {
    expect(parseDataUri("data:image/png;base64,AAAB")).toEqual({ mimeType: "image/png", base64: "AAAB" });
  });

  it("tolerates newlines inside base64 payload", () => {
    expect(parseDataUri("data:image/jpeg;base64,AA\nBB")?.base64).toBe("AA\nBB");
  });

  it("returns null for http urls and non-strings", () => {
    expect(parseDataUri("https://x/y.png")).toBeNull();
    expect(parseDataUri(null)).toBeNull();
  });

  it("encode/parse roundtrip", () => {
    const uri = encodeDataUri("image/webp", "ZZZ");
    expect(parseDataUri(uri)).toEqual({ mimeType: "image/webp", base64: "ZZZ" });
  });
});
