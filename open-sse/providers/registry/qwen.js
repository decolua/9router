export default {
  id: "qwen",
  priority: 85,
  alias: "qwen",
  display: {
    name: "Qwen",
    icon: "bolt",
    color: "#FF6B35",
    textIcon: "QW",
    website: "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions",
    notice: {
      apiKeyUrl: "https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    validateUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
  },
  models: [
    { id: "qwen-max", name: "Qwen Max" },
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "qwen-turbo", name: "Qwen Turbo" },
    { id: "qwen-long", name: "Qwen Long" },
    { id: "qwen-flash", name: "Qwen Flash" },
    { id: "qwen-vl", name: "Qwen Vision" },
    { id: "qwen-coder", name: "Qwen Coder" },
    { id: "qwen-omni", name: "Qwen Omni" },
    { id: "qwen-math", name: "Qwen Math" },
  ],
};
