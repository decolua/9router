// Smoke tests for the new OpenAI/Anthropic parity handler cores.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deriveImageEditsUrl,
  handleImageEditCore,
} from "../../open-sse/handlers/imageEditCore.js";
import {
  deriveModerationsUrl,
  handleModerationsCore,
} from "../../open-sse/handlers/moderationsCore.js";
import {
  deriveRerankUrl,
  handleRerankCore,
} from "../../open-sse/handlers/rerankCore.js";
import {
  deriveCountTokensUrl,
  estimateTokens,
  handleCountTokensCore,
} from "../../open-sse/handlers/countTokensCore.js";

describe("imageEditCore", () => {
  it("deriveImageEditsUrl maps /generations to /edits", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://api.openai.com/v1/images/generations" }))
      .toBe("https://api.openai.com/v1/images/edits");
  });

  it("deriveImageEditsUrl returns null for non-generations URL", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://example.com/v1/images/variations" })).toBeNull();
  });
});

describe("moderationsCore", () => {
  it("deriveModerationsUrl maps /chat/completions to /moderations", () => {
    expect(deriveModerationsUrl("https://api.openai.com/v1/chat/completions"))
      .toBe("https://api.openai.com/v1/moderations");
  });

  it("deriveModerationsUrl handles /openai segment", () => {
    expect(deriveModerationsUrl("https://api.deepinfra.com/v1/openai/chat/completions"))
      .toBe("https://api.deepinfra.com/v1/openai/moderations");
  });
});

describe("rerankCore", () => {
  it("deriveRerankUrl maps chat completions base to /rerank", () => {
    expect(deriveRerankUrl({ baseUrl: "https://api.cohere.com/v1/chat/completions" }, {}))
      .toBe("https://api.cohere.com/v1/rerank");
  });

  it("deriveRerankUrl maps embeddings base to /rerank", () => {
    expect(deriveRerankUrl(null, { embeddingConfig: { baseUrl: "https://api.voyageai.com/v1/embeddings" } }))
      .toBe("https://api.voyageai.com/v1/rerank");
  });

  it("deriveRerankUrl returns null when no endpoint derivable", () => {
    expect(deriveRerankUrl(null, {})).toBeNull();
  });
});

describe("countTokensCore", () => {
  it("deriveCountTokensUrl maps Claude /messages to /messages/count_tokens", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.anthropic.com/v1/messages", format: "claude" }))
      .toBe("https://api.anthropic.com/v1/messages/count_tokens");
  });

  it("deriveCountTokensUrl returns null for non-Claude provider", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.openai.com/v1/chat/completions", format: "openai" }))
      .toBeNull();
  });

  it("estimateTokens approximates from string content", () => {
    const body = { messages: [{ role: "user", content: "abcd" }] };
    expect(estimateTokens(body)).toBe(1);
  });

  it("estimateTokens sums text array parts", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "abcdefgh" }] }] };
    expect(estimateTokens(body)).toBe(2);
  });

  it("estimateTokens returns at least 1 for empty body", () => {
    expect(estimateTokens({})).toBe(1);
  });
});
