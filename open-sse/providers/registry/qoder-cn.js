export default {
  id: "qoder-cn",
  priority: 31,
  alias: "qdc",
  uiAlias: "qdc",
  display: {
    name: "Qoder CN",
    icon: "water_drop",
    color: "#DB2777",
    website: "https://qoder.com.cn",
    notice: {
      signupUrl: "https://qoder.com.cn",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://api3.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    stallTimeoutMs: 120000,
    usage: {
      url: "https://openapi.qoder.com.cn/api/v2/quota/usage",
    },
  },
  models: [
    { id: "qmodel_latest", name: "Qoder Qwen 3.7 Max" },
  ],
  oauth: {
    region: "cn",
    openApiBaseUrl: "https://openapi.qoder.com.cn",
    centerBaseUrl: "",
    chatBaseUrl: "https://api3.qoder.com.cn",
    deviceTokenUrl: "https://openapi.qoder.com.cn/api/v1/deviceToken/poll",
    refreshUrl: "",
    userInfoUrl: "https://openapi.qoder.com.cn/api/v1/userinfo",
    quotaUsageUrl: "https://openapi.qoder.com.cn/api/v2/quota/usage",
    loginUrl: "https://qoder.com.cn/users/sign-in",
    deviceAuthorizationUrl: "https://qoder.com.cn/device/selectAccounts",
    clientId: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c",
    redirectUri: "qoder-work-cn://",
    bizVariant: "qoderwork",
    useSignInCallback: true,
  },
  features: {
    usage: true,
  },
};
