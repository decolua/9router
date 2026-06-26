export default {
  id: "xunfei",
  priority: 280,
  alias: "xunfei",
  aliases: [
    "xf",
    "spark",
  ],
  uiAlias: "xunfei",
  display: {
    name: "Xunfei Spark",
    icon: "cloud",
    color: "#2962FF",
    textIcon: "XF",
    website: "https://maas-api.xf-yun.com",
    notice: {
      apiKeyUrl: "https://console.xfyun.cn/services/coding",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions",
    headers: {},
  },
  models: [
    { id: "xsparkx2flash", name: "Spark X2 Flash" },
    { id: "xopqwen36v35b", name: "Qwen3.6-35B-A3B" },
    { id: "xopqwen35v35b", name: "Qwen3.5-35B-A3B" },
    { id: "xop3qwencodernext", name: "Qwen3 Coder Next" },
    { id: "xopglmv47flash", name: "GLM 4.7 Flash" },
  ],
};
