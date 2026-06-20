import { describe, it, expect } from "vitest";
import { deriveRerankUrl } from "../../open-sse/handlers/rerankCore.js";

// The novel logic in rerankCore is the dual-source /rerank URL derivation (chat
// providers vs embedding-only providers). proxyAwareFetch captures originalFetch
// at import time, so the forwarding path can't be fetch-mocked; the URL-derivation
// logic (the part that can break) is exercised directly here.
describe("deriveRerankUrl", () => {
  it("derives /rerank from a chat-completions transport.baseUrl", () => {
    expect(deriveRerankUrl({ transport: { baseUrl: "https://api.cohere.ai/v1/chat/completions" } })).toBe(
      "https://api.cohere.ai/v1/rerank"
    );
  });

  it("derives /rerank from an embedding-only provider's embeddingConfig.baseUrl (voyage)", () => {
    expect(deriveRerankUrl({ transport: null, embeddingConfig: { baseUrl: "https://api.voyageai.com/v1/embeddings" } })).toBe(
      "https://api.voyageai.com/v1/rerank"
    );
  });

  it("derives /rerank from jina embeddingConfig.baseUrl", () => {
    expect(deriveRerankUrl({ embeddingConfig: { baseUrl: "https://api.jina.ai/v1/embeddings" } })).toBe(
      "https://api.jina.ai/v1/rerank"
    );
  });

  it("returns null when neither source has a derivable endpoint", () => {
    expect(deriveRerankUrl({ transport: { baseUrl: "https://api.example.com/v1/standalone" } })).toBe(null);
    expect(deriveRerankUrl({})).toBe(null);
    expect(deriveRerankUrl(null)).toBe(null);
  });

  it("returns null when transport.baseUrl lacks /chat/completions even if embeddingConfig present without /embeddings", () => {
    expect(deriveRerankUrl({ transport: { baseUrl: "https://x/v1/chat" }, embeddingConfig: { baseUrl: "https://x/v1/vec" } })).toBe(null);
  });
});
