export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama",
  },
  models: [
    { id: "embeddinggemma", name: "EmbeddingGemma", kind: "embedding" },
    { id: "nomic-embed-text", name: "Nomic Embed Text", kind: "embedding" },
    { id: "bge-m3", name: "BGE M3", kind: "embedding" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "http://localhost:11434/v1/embeddings", authType: "none" },
};
