export default {
  id: "vertex-partner",
  priority: 260,
  alias: "vertex-partner",
  aliases: [
    "vxp",
  ],
  uiAlias: "vxp",
  display: {
    name: "Vertex Partner",
    icon: "cloud",
    color: "#34A853",
    textIcon: "VP",
    website: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models",
    notice: {
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
  },
  models: [
    { id: "deepseek-ai/deepseek-v3.2-maas", name: "DeepSeek V3.2 (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-thinking-maas", name: "Qwen3 Next 80B Thinking (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-instruct-maas", name: "Qwen3 Next 80B Instruct (Vertex)" },
    { id: "zai-org/glm-5-maas", name: "GLM-5 (Vertex)" },
  ],
};
