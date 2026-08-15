// Locks edge cases flagged in docs 11 §1/§4 that were only covered indirectly.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { parseDataUri, encodeDataUri } from "../../open-sse/translator/concerns/image.js";

describe("normalizeClaudePassthrough — haiku adaptive thinking (docs 11 §1)", () => {
  it("downgrades adaptive thinking to enabled+budget for haiku models", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-haiku-4-5");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("keeps adaptive thinking for sonnet/opus", () => {
    const out = normalizeClaudePassthrough({ thinking: { type: "adaptive" } }, "claude-sonnet-4-6");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  // Upstream 7e5f5a88 reversed hoisting to folding for cache-breakpoint correctness:
  // mid-conversation system messages folded into the neighbouring user turn preserve
  // the cached prefix on subsequent requests, while hoisting would invalidate it.
  it("folds mid-conversation system messages into the neighbouring user turn", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    });
    // System text is folded into the preceding user message's content
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "text", text: "be brief" },
      ],
    });
    // No message has role "system"
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
