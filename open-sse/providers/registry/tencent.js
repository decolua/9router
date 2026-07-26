export default {
  id: "tencent",
  alias: "hunyuan",
  aliases: ["hunyuan", "tencent-hunyuan"],
  uiAlias: "hunyuan",
  display: {
    name: "Tencent Hunyuan",
    icon: "cloud",
    color: "#0052D9",
    textIcon: "HY",
    website: "https://cloud.tencent.com/product/hunyuan",
    notice: {
      apiKeyUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    validateUrl: "https://api.hunyuan.cloud.tencent.com/v1/models",
  },
  models: [
    { id: "hunyuan-turbos-latest", name: "Hunyuan TurboS Latest" },
    { id: "hunyuan-t1-latest", name: "Hunyuan T1 Latest" },
    { id: "hunyuan-pro", name: "Hunyuan Pro" },
    { id: "hunyuan-vision", name: "Hunyuan Vision" },
    { id: "hunyuan-functioncall", name: "Hunyuan FunctionCall" },
    { id: "hunyuan-lite", name: "Hunyuan Lite" },
  ],
};
