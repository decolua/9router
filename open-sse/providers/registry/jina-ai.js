export default {
  id: "jina-ai",
  alias: "jina",
  display: {
    name: "Jina AI",
    icon: "blur_on",
    color: "#2563EB",
    textIcon: "JA",
    website: "https://jina.ai",
    notice: {
      text: "10M free tokens on signup (non-commercial), no credit card required.",
      apiKeyUrl: "https://jina.ai/?sui=apikey"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "embedding"
  ],
  embeddingConfig: {
    baseUrl: "https://api.jina.ai/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
    models: [
      {
        id: "jina-embeddings-v3",
        name: "Jina Embeddings v3",
        dimensions: 1024
      },
      {
        id: "jina-embeddings-v2-base-en",
        name: "Jina Embeddings v2 Base EN",
        dimensions: 768
      },
      {
        id: "jina-embeddings-v2-base-code",
        name: "Jina Embeddings v2 Base Code",
        dimensions: 768
      }
    ]
  }
};
