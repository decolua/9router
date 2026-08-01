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

  // Used to hoist these into top-level `system`. That grew the cached prefix by a
  // block every time Claude Code injected a reminder, invalidating every cached
  // message behind it (~133k tokens re-written per occurrence in production), so
  // they are now converted in place. The invariant that matters is unchanged:
  // no role:"system" may reach the API inside messages.
  it("converts mid-conversation system messages to user in place", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    });
    expect(out.system).toBeUndefined();
    expect(out.messages.every((m) => m.role !== "system")).toBe(true);
    expect(out.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "be brief" }] });
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
