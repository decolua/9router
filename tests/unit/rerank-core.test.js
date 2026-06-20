import { describe, it, expect } from "vitest";
import { deriveRerankUrl } from "../../open-sse/handlers/rerankCore.js";

// deriveRerankUrl takes (transportCfg, mediaCfg): chat providers expose their
// baseUrl on the transport; embedding-only providers (transport:null) expose
// embeddingConfig via PROVIDER_MEDIA. The forwarding path can't be fetch-mocked
// (proxyAwareFetch captures originalFetch at import), so the derivation logic is
// exercised directly here.
describe("deriveRerankUrl", () => {
  it("derives /rerank from a chat-completions transport baseUrl", () => {
    expect(deriveRerankUrl({ baseUrl: "https://api.cohere.ai/v1/chat/completions" }, undefined)).toBe(
      "https://api.cohere.ai/v1/rerank"
    );
  });

  it("derives /rerank from an embedding-only provider's embeddingConfig (voyage)", () => {
    expect(deriveRerankUrl(undefined, { embeddingConfig: { baseUrl: "https://api.voyageai.com/v1/embeddings" } })).toBe(
      "https://api.voyageai.com/v1/rerank"
    );
  });

  it("derives /rerank from jina embeddingConfig", () => {
    expect(deriveRerankUrl(null, { embeddingConfig: { baseUrl: "https://api.jina.ai/v1/embeddings" } })).toBe(
      "https://api.jina.ai/v1/rerank"
    );
  });

  it("returns null when neither source has a derivable endpoint", () => {
    expect(deriveRerankUrl({ baseUrl: "https://api.example.com/v1/standalone" }, undefined)).toBe(null);
    expect(deriveRerankUrl({}, {})).toBe(null);
    expect(deriveRerankUrl(null, null)).toBe(null);
  });

  it("returns null when transport baseUrl lacks /chat/completions and embeddingConfig lacks /embeddings", () => {
    expect(deriveRerankUrl({ baseUrl: "https://x/v1/chat" }, { embeddingConfig: { baseUrl: "https://x/v1/vec" } })).toBe(null);
  });
});
