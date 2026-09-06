export default {
  id: "meta",
  priority: 40,
  alias: "meta",
  aliases: ["meta-ai", "llama"],
  uiAlias: "meta",
  display: {
    name: "Meta AI",
    icon: "bolt",
    color: "#0064E0",
    textIcon: "MA",
    website: "https://dev.meta.ai",
    notice: {
      text: "Meta Model API. OpenAI-compatible endpoint for Meta's Muse Spark reasoning models.",
      apiKeyUrl: "https://dev.meta.ai",
    },
  },
  category: "apikey",
  thinkingConfig: {
    // Muse Spark always reasons; it rejects "none" (HTTP 400) and does not
    // support "max". Accepted: minimal / low / medium / high / xhigh.
    options: ["minimal", "low", "medium", "high", "xhigh"],
    defaultMode: "low",
  },
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    thinkingFormat: "meta",
  },
  models: [
    // Muse Spark models are served by /v1/responses (reasoning summary + encrypted
    // replay); each declares the Responses target format so the gateway translates
    // OpenAI Chat → Responses and back. Matches dispatch via openai-responses.
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", targetFormat: "openai-responses" },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", targetFormat: "openai-responses" },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", targetFormat: "openai-responses" },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: "https://api.meta.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
