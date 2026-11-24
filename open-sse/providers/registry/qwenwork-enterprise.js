// QwenWork enterprise flagship (企业旗舰版) — the deployable on the
// enterprise's own domain. The transport/oauth URLs here are the public
// gateway placeholders: the OAuth provider rewrites them onto
// https://<domain> at sign-in (the user enters the domain), and every
// runtime request routes via the connection's providerSpecificData.
// enterpriseHost (see shared/qoder/sites.js qoderInferenceBaseForSite).
export default {
  id: "qwenwork-enterprise",
  priority: 30,
  alias: "qwwe",
  uiAlias: "qwwe",
  display: {
    name: "QwenWork 企业版",
    icon: "hub",
    color: "#6D28D9",
    website: "https://qwenwork.cn",
    notice: {
      signupUrl: "https://qwenwork.cn",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  authHint: "登录时输入企业域名（企业管理后台地址栏的域名），无 PAT 支持",
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
    { id: "flash", name: "标准" },
    { id: "pro", name: "高级" },
    { id: "qwen3.8-max-preview", name: "Qwen3.8-Max" },
  ],
  oauth: {
    // Placeholder hosts — the sign-in asks for the enterprise's own domain
    // and the provider rewrites every URL onto https://<domain>.
    openApiBaseUrl: "https://gateway.qwenwork.cn",
    centerBaseUrl: "https://gateway.qwenwork.cn",
    chatBaseUrl: "https://gateway.qwenwork.cn",
    deviceTokenUrl: "https://gateway.qwenwork.cn/api/v1/deviceToken/poll",
    refreshUrl: "https://gateway.qwenwork.cn/api/v1/deviceToken/refresh",
    userInfoUrl: "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing",
    quotaUsageUrl: "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota",
    loginUrl: "https://gateway.qwenwork.cn/device/selectAccounts",
    clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
    // The enterprise device flow sends no redirect_uri.
    redirectUri: null,
  },
  features: {
    usage: true,
  },
};
