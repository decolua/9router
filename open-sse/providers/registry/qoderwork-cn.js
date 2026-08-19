export default {
  id: "qoderwork-cn",
  priority: 85,
  alias: "qdcn",
  uiAlias: "qdcn",
  display: {
    name: "QoderWork CN",
    icon: "water_drop",
    color: "#DB2777",
    website: "https://qoder.com.cn",
    notice: {
      signupUrl: "https://qoder.com.cn",
    },
  },
  category: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  transport: {
    baseUrl:
      "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    usage: {
      url: "https://openapi.qoder.com.cn/api/v2/quota/usage",
    },
  },
  models: [
    { id: "auto", name: "Auto" },
    { id: "qmodel_preview", name: "Qwen3.8-Max-Preview" },
    { id: "qmodel_latest", name: "Qwen3.7-Max" },
    { id: "qmodel", name: "Qwen3.7-Plus" },
    { id: "q36fmodel", name: "Qwen3.6-Flash" },
    { id: "dmodel", name: "DeepSeek-V4-Pro" },
    { id: "dfmodel", name: "DeepSeek-V4-Flash" },
    { id: "gm51model", name: "GLM-5.2" },
    { id: "kmodel", name: "Kimi-K2.7-Code" },
    { id: "mmodel", name: "MiniMax-M2.7" },
  ],
  oauth: {
    openApiBaseUrl: "https://openapi.qoder.com.cn",
    chatBaseUrl: "https://gateway.qoder.com.cn",
    deviceTokenUrl: "https://openapi.qoder.com.cn/api/v1/deviceToken/poll",
    refreshUrl: "https://openapi.qoder.com.cn/api/v1/deviceToken/refresh",
    userInfoUrl: "https://openapi.qoder.com.cn/api/v1/userinfo",
    loginUrl: "https://qoder.com.cn/device/selectAccounts",
    clientId: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c",
    redirectUri: "qoder-work-cn://",
  },
  features: {
    usage: true,
    profileRefresh: true,
  },
  protocolProfile: "cn-work",
};
