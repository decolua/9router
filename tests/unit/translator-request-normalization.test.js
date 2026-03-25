import { describe, it, expect } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { filterToOpenAIFormat, normalizeOpenAIContent } from "../../open-sse/translator/helpers/openaiHelper.js";
import { parseSSELine } from "../../open-sse/utils/streamHelpers.js";

describe("request normalization", () => {
  it("claudeToOpenAIRequest flattens text-only content arrays into string", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "text", text: "there" },
          ],
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-oss:120b", body, true);
    expect(result.messages[0].content).toBe("hi\nthere");
  });

  it("claudeToOpenAIRequest preserves multimodal arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "ZmFrZQ==",
              },
            },
          ],
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-4o", body, true);
    expect(Array.isArray(result.messages[0].content)).toBe(true);
  });

  it("filterToOpenAIFormat flattens text-only arrays to string", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    expect(result.messages[0].content).toBe("a\nb");
  });

  it("translateRequest keeps /v1/messages Claude->OpenAI text payloads string-safe", () => {
    const body = {
      model: "ollama/gpt-oss:120b",
      system: [{ type: "text", text: "You are helpful." }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
      ],
      stream: true,
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "gpt-oss:120b",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "ollama",
    );

    const userMessage = result.messages.find((m) => m.role === "user");
    expect(typeof userMessage.content).toBe("string");
    expect(userMessage.content).toBe("hello\nworld");
  });

  describe("normalizeOpenAIContent (shared implementation)", () => {
    it("returns empty string for empty array", () => {
      expect(normalizeOpenAIContent([])).toBe("");
    });

    it("flattens multiple text blocks into joined string", () => {
      const content = [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ];
      expect(normalizeOpenAIContent(content)).toBe("hello\nworld");
    });

    it("unwraps single text block to plain string", () => {
      const content = [{ type: "text", text: "solo" }];
      expect(normalizeOpenAIContent(content)).toBe("solo");
    });

    it("preserves multimodal array as-is", () => {
      const content = [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ];
      const result = normalizeOpenAIContent(content);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("handles text blocks with empty text", () => {
      const content = [
        { type: "text", text: "" },
        { type: "text", text: "hi" },
      ];
      expect(normalizeOpenAIContent(content)).toBe("\nhi");
    });
  });

  it("parseSSELine supports Ollama NDJSON with explicit format", () => {
    const raw = JSON.stringify({
      model: "gpt-oss:120b",
      message: { role: "assistant", content: "hello" },
      done: false,
    });

    const parsed = parseSSELine(raw, "ollama");
    expect(parsed).toEqual({
      model: "gpt-oss:120b",
      message: { role: "assistant", content: "hello" },
      done: false,
    });
  });

  it("parseSSELine falls back to raw JSON for unknown formats", () => {
    const raw = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const parsed = parseSSELine(raw);
    expect(parsed.choices[0].delta.content).toBe("hi");
  });

  it("parseSSELine prefers SSE data: prefix over raw JSON fallback", () => {
    const parsed = parseSSELine('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(parsed.choices[0].delta.content).toBe("hi");
  });

  it("parseSSELine returns null for non-JSON non-SSE lines", () => {
    expect(parseSSELine("event: message")).toBeNull();
    expect(parseSSELine(": comment")).toBeNull();
    expect(parseSSELine("not json at all")).toBeNull();
  });
});
