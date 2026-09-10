export default {
  id: "qwen",
  priority: 12,
  alias: "qwen",
  aliases: ["qw"],
  display: {
    name: "Qwen",
    icon: "sparkles",
    color: "#6366F1",
    textIcon: "Qw",
    website: "https://www.alibabacloud.com/en/product/model-studio",
    notice: {
      apiKeyUrl:
        "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl:
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  models: [
    // Flagship & API models
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.7-flash", name: "Qwen3.7 Flash" },
    // Open-source models
    { id: "qwen3.8-2.4t-a95b", name: "Qwen3.8 2.4T MoE (Open)" },
    { id: "qwen3.8-27b", name: "Qwen3.8 27B (Open)" },
    { id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B MoE (Open)" },
    { id: "qwen3.6-27b", name: "Qwen3.6 27B (Open)" },
  ],
};
