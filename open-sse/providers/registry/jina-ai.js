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
  models: [
    { id: "jina-embeddings-v3", name: "Jina Embeddings v3", kind: "embedding" },
    { id: "jina-embeddings-v2-base-en", name: "Jina Embeddings v2 Base EN", kind: "embedding" },
    { id: "jina-embeddings-v2-base-code", name: "Jina Embeddings v2 Base Code", kind: "embedding" },
    { id: "jina-ai/jina-code-embeddings-0.5b", name: "Jina Code Embeddings 0.5B", kind: "embedding" },
    { id: "jina-ai/jina-code-embeddings-1.5b", name: "Jina Code Embeddings 1.5B", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v4", name: "Jina Embeddings v4", kind: "embedding" },
    { id: "jina-ai/jina-clip-v2", name: "Jina CLIP v2", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v3", name: "Jina Embeddings v3", kind: "embedding" },
    { id: "jina-ai/jina-colbert-v2", name: "Jina ColBERT v2", kind: "embedding" },
    { id: "jina-ai/jina-clip-v1", name: "Jina CLIP v1", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v2-base-es", name: "Jina Embeddings v2 Base ES", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v2-base-code", name: "Jina Embeddings v2 Base Code", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v2-base-de", name: "Jina Embeddings v2 Base DE", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v2-base-zh", name: "Jina Embeddings v2 Base ZH", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v2-base-en", name: "Jina Embeddings v2 Base EN", kind: "embedding" },
    { id: "jina-ai/jina-embedding-b-en-v1", name: "Jina Embedding B EN v1", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v5-text-small", name: "Jina Embeddings v5 Text Small", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v5-omni-small", name: "Jina Embeddings v5 Omni Small", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v5-omni-nano", name: "Jina Embeddings v5 Omni Nano", kind: "embedding" },
    { id: "jina-ai/jina-embeddings-v5-text-nano", name: "Jina Embeddings v5 Text Nano", kind: "embedding" },
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
      },
      { id: "jina-ai/jina-code-embeddings-0.5b", name: "Jina Code Embeddings 0.5B" },
      { id: "jina-ai/jina-code-embeddings-1.5b", name: "Jina Code Embeddings 1.5B" },
      { id: "jina-ai/jina-embeddings-v4", name: "Jina Embeddings v4" },
      { id: "jina-ai/jina-clip-v2", name: "Jina CLIP v2" },
      { id: "jina-ai/jina-embeddings-v3", name: "Jina Embeddings v3" },
      { id: "jina-ai/jina-colbert-v2", name: "Jina ColBERT v2" },
      { id: "jina-ai/jina-clip-v1", name: "Jina CLIP v1" },
      { id: "jina-ai/jina-embeddings-v2-base-es", name: "Jina Embeddings v2 Base ES" },
      { id: "jina-ai/jina-embeddings-v2-base-code", name: "Jina Embeddings v2 Base Code" },
      { id: "jina-ai/jina-embeddings-v2-base-de", name: "Jina Embeddings v2 Base DE" },
      { id: "jina-ai/jina-embeddings-v2-base-zh", name: "Jina Embeddings v2 Base ZH" },
      { id: "jina-ai/jina-embeddings-v2-base-en", name: "Jina Embeddings v2 Base EN" },
      { id: "jina-ai/jina-embedding-b-en-v1", name: "Jina Embedding B EN v1" },
      { id: "jina-ai/jina-embeddings-v5-text-small", name: "Jina Embeddings v5 Text Small" },
      { id: "jina-ai/jina-embeddings-v5-omni-small", name: "Jina Embeddings v5 Omni Small" },
      { id: "jina-ai/jina-embeddings-v5-omni-nano", name: "Jina Embeddings v5 Omni Nano" },
      { id: "jina-ai/jina-embeddings-v5-text-nano", name: "Jina Embeddings v5 Text Nano" },
    ]
  }
};
