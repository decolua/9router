export default {
  id: "mistral",
  priority: 80,
  alias: "mistral",
  display: {
    name: "Mistral",
    icon: "air",
    color: "#FF7000",
    textIcon: "MI",
    website: "https://mistral.ai",
    notice: {
      apiKeyUrl: "https://console.mistral.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    validateUrl: "https://api.mistral.ai/v1/models",
    quirks: {
      dropClientMetadata: true,
    },
  },
  models: [
    { id: "mistral-large-latest", name: "Mistral Large 3" },
    { id: "codestral-latest", name: "Codestral" },
    { id: "mistral-medium-latest", name: "Mistral Medium 3" },
    { id: "mistral-embed", name: "Mistral Embed", kind: "embedding" },
    { id: "mistral-ocr-latest", name: "Mistral OCR", kind: "ocr" },
    { id: "mistral-moderation-latest", name: "Mistral Moderation", kind: "moderation" },
  ],
  serviceKinds: ["llm","imageToText","embedding","ocr","moderation"],
  embeddingConfig: { baseUrl: "https://api.mistral.ai/v1/embeddings", authType: "apikey", authHeader: "bearer" },
  ocrConfig: { baseUrl: "https://api.mistral.ai/v1/ocr", authType: "apikey", authHeader: "bearer" },
  moderationConfig: { baseUrl: "https://api.mistral.ai/v1/moderations", authType: "apikey", authHeader: "bearer" },
};
