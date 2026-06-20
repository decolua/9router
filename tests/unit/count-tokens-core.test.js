import { describe, it, expect } from "vitest";
import { deriveCountTokensUrl, estimateTokens } from "../../open-sse/handlers/countTokensCore.js";

describe("deriveCountTokensUrl", () => {
  it("derives /messages/count_tokens for a Claude-compatible /messages baseUrl", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.anthropic.com/v1/messages", format: "claude" })).toBe(
      "https://api.anthropic.com/v1/messages/count_tokens"
    );
  });

  it("derives for glm (z.ai anthropic endpoint)", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.z.ai/api/anthropic/v1/messages", format: "claude" })).toBe(
      "https://api.z.ai/api/anthropic/v1/messages/count_tokens"
    );
  });

  it("derives for a /messages baseUrl even without explicit claude format", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://example.com/v1/messages" })).toBe(
      "https://example.com/v1/messages/count_tokens"
    );
  });

  it("returns null for an OpenAI chat-completions provider (not Claude-compatible)", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.openai.com/v1/chat/completions", format: "openai" })).toBe(null);
  });

  it("returns null when there is no baseUrl", () => {
    expect(deriveCountTokensUrl({})).toBe(null);
    expect(deriveCountTokensUrl(null)).toBe(null);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars/token from string content", () => {
    expect(estimateTokens({ messages: [{ role: "user", content: "hello world!" }] })).toBe(3); // 12 chars / 4
  });

  it("sums array content text parts", () => {
    expect(estimateTokens({ messages: [{ role: "user", content: [{ type: "text", text: "abcdefgh" }] }] })).toBe(2);
  });

  it("includes the system field", () => {
    const n = estimateTokens({ system: "abcd", messages: [{ role: "user", content: "efgh" }] });
    expect(n).toBe(2); // 8 chars / 4
  });

  it("returns at least 1 for empty bodies", () => {
    expect(estimateTokens({})).toBe(1);
    expect(estimateTokens({ messages: [] })).toBe(1);
  });
});
