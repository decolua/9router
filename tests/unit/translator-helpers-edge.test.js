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

  it("hoists mid-conversation system messages into top-level system", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    });
    expect(out.system).toEqual([{ type: "text", text: "be brief" }]);
    expect(out.messages.every((m) => m.role !== "system")).toBe(true);
  });
});

describe("normalizeClaudePassthrough — server tool models", () => {
  it("strips 9router's cc/ prefix from an Advisor server tool only", () => {
    const body = {
      model: "cc/claude-opus-4-8",
      tools: [
        {
          type: "advisor_20260301",
          name: "advisor",
          model: "cc/claude-opus-4-8",
          input_schema: { type: "object", properties: { question: { type: "string" } } },
        },
      ],
    };

    expect(normalizeClaudePassthrough(body)).toEqual({
      model: "cc/claude-opus-4-8",
      tools: [
        {
          type: "advisor_20260301",
          name: "advisor",
          model: "claude-opus-4-8",
          input_schema: { type: "object", properties: { question: { type: "string" } } },
        },
      ],
    });
  });

  it("normalizes a Task/subagent tool using the canonical claude/ provider prefix", () => {
    const body = {
      tools: [
        {
          name: "Task",
          description: "Launch a subagent",
          model: "claude/claude-sonnet-4-6",
          input_schema: { type: "object", required: ["prompt"] },
        },
      ],
    };

    expect(normalizeClaudePassthrough(body)).toEqual({
      tools: [
        {
          name: "Task",
          description: "Launch a subagent",
          model: "claude-sonnet-4-6",
          input_schema: { type: "object", required: ["prompt"] },
        },
      ],
    });
  });

  it("is idempotent and preserves missing, non-string, and unrelated models", () => {
    const body = {
      model: "claude-opus-4-8",
      tools: [
        { type: "advisor_20260301", model: "claude-opus-4-8", cache_control: { type: "ephemeral" } },
        { name: "without-model", description: "unchanged" },
        { name: "numeric-model", model: 42 },
        { name: "other-provider", model: "openrouter/anthropic/claude-opus-4.1" },
        null,
      ],
    };
    const expected = {
      model: "claude-opus-4-8",
      tools: [
        { type: "advisor_20260301", model: "claude-opus-4-8", cache_control: { type: "ephemeral" } },
        { name: "without-model", description: "unchanged" },
        { name: "numeric-model", model: 42 },
        { name: "other-provider", model: "openrouter/anthropic/claude-opus-4.1" },
        null,
      ],
    };

    expect(normalizeClaudePassthrough(body)).toEqual(expected);
    expect(normalizeClaudePassthrough(body)).toEqual(expected);
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
