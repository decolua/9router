/**
 * Format detection tests — detectFormatByEndpoint, FORMATS constants
 *
 * Covers:
 *  - /v1/chat/completions endpoint detection
 *  - /v1/responses endpoint detection (OPENAI_RESPONSES format)
 *  - /v1/chat/completions with Cursor CLI input[] body → treated as OPENAI
 *  - Null return for unrecognized endpoints (fallback to body-based detection)
 *  - FORMATS constant values
 */

import { describe, it, expect } from "vitest";
import {
  detectFormatByEndpoint,
  FORMATS,
} from "../../open-sse/translator/formats.js";

describe("FORMATS constants", () => {
  it("defines expected format identifiers", () => {
    expect(FORMATS.OPENAI).toBe("openai");
    expect(FORMATS.CLAUDE).toBe("claude");
    expect(FORMATS.GEMINI).toBe("gemini");
    expect(FORMATS.GEMINI_CLI).toBe("gemini-cli");
    expect(FORMATS.ANTIGRAVITY).toBe("antigravity");
    expect(FORMATS.OPENAI_RESPONSES).toBe("openai-responses");
    expect(FORMATS.OLLAMA).toBe("ollama");
  });
});

describe("detectFormatByEndpoint", () => {
  describe("/v1/responses endpoint", () => {
    it("returns OPENAI_RESPONSES for /v1/responses", () => {
      const result = detectFormatByEndpoint("/v1/responses", {});
      expect(result).toBe(FORMATS.OPENAI_RESPONSES);
    });

    it("returns OPENAI_RESPONSES regardless of body content", () => {
      const result = detectFormatByEndpoint("/v1/responses", {
        model: "gpt-4o",
        input: [{ role: "user", content: "hi" }],
      });
      expect(result).toBe(FORMATS.OPENAI_RESPONSES);
    });

    it("returns OPENAI_RESPONSES for nested path containing /v1/responses", () => {
      const result = detectFormatByEndpoint(
        "/proxy/v1/responses",
        {}
      );
      expect(result).toBe(FORMATS.OPENAI_RESPONSES);
    });
  });

  describe("/v1/chat/completions with Cursor CLI body", () => {
    it("returns OPENAI when chat/completions has input[] array (Cursor CLI)", () => {
      const body = {
        model: "gpt-4o",
        input: [{ role: "user", content: "hi" }],
      };
      const result = detectFormatByEndpoint(
        "/v1/chat/completions",
        body
      );
      expect(result).toBe(FORMATS.OPENAI);
    });

    it("returns null for normal chat/completions without input[]", () => {
      const body = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      };
      const result = detectFormatByEndpoint(
        "/v1/chat/completions",
        body
      );
      expect(result).toBeNull();
    });
  });

  describe("fallback behavior", () => {
    it("returns null for /v1/messages (Claude native endpoint)", () => {
      const result = detectFormatByEndpoint("/v1/messages", {});
      expect(result).toBeNull();
    });

    it("returns null for unknown endpoints", () => {
      const result = detectFormatByEndpoint("/api/custom", {});
      expect(result).toBeNull();
    });

    it("returns null when body is undefined", () => {
      const result = detectFormatByEndpoint("/v1/chat/completions", undefined);
      expect(result).toBeNull();
    });

    it("returns null when body is null", () => {
      const result = detectFormatByEndpoint("/v1/chat/completions", null);
      expect(result).toBeNull();
    });
  });
});
