export default {
  id: "baidu",
  alias: "qianfan",
  aliases: ["qianfan", "ernie", "baidu-qianfan"],
  uiAlias: "qianfan",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Baidu Qianfan",
    icon: "search",
    color: "#2932E1",
    textIcon: "BD",
    website: "https://cloud.baidu.com/product/qianfan.html",
    notice: {
      apiKeyUrl:
        "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    },
  },
  transport: {
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    validateUrl: "https://qianfan.baidubce.com/v2/models",
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1048576 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576 },
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 512000 },
    { id: "glm-5.1", name: "GLM 5.1", contextLength: 198000 },
    { id: "kimi-k2.6", name: "Kimi K2.6", contextLength: 262144 },
    { id: "qwen3.5-397b-a17b", name: "Qwen 3.5 397B A17B", contextLength: 262144 },
    { id: "qwen3.5-27b", name: "Qwen 3.5 27B", contextLength: 262144 },
  ],
};
