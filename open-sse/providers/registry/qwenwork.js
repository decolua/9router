// QwenWork (千问办公) — OAuth-only Qwen agent chat via gateway.qwenwork.cn.
// Mirrors magpie-community/plugins PR #319: no PAT support, account login only.
export default {
  id: "qwenwork",
  priority: 116,
  alias: "qww",
  uiAlias: "qww",
  display: {
    name: "QwenWork",
    icon: "hub",
    color: "#8B5CF6",
    website: "https://qwenwork.cn",
    notice: {
      signupUrl: "https://qwenwork.cn",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  authHint: "QwenWork has no Personal Access Token — account login (device token) only.",
  transport: {
    baseUrl: "https://gateway.qwenwork.cn/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    stallTimeoutMs: 120000,
    usage: {
      url: "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota",
    },
  },
  models: [
    { id: "flash", name: "Flash" },
    { id: "pro", name: "Pro" },
    { id: "qwen3.8-max-preview", name: "Qwen3.8-Max Preview" },
  ],
  oauth: {
    openApiBaseUrl: "https://gateway.qwenwork.cn",
    centerBaseUrl: "https://gateway.qwenwork.cn",
    chatBaseUrl: "https://gateway.qwenwork.cn",
    deviceTokenUrl: "https://gateway.qwenwork.cn/api/v1/deviceToken/poll",
    refreshUrl: "https://gateway.qwenwork.cn/api/v1/deviceToken/refresh",
    userInfoUrl: "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing",
    quotaUsageUrl: "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota",
    loginUrl: "https://gateway.qwenwork.cn/device/selectAccounts",
  },
  features: {
    usage: true,
  },
};
