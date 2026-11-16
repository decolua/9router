export default {
  id: "qoder",
  priority: 30,
  alias: "qd",
  uiAlias: "qd",
  display: {
    name: "Qoder",
    icon: "water_drop",
    color: "#EC4899",
    website: "https://qoder.com",
    notice: {
      signupUrl: "https://qoder.com",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  authHint: "Personal Access Token (pt-...) từ https://qoder.com/account/integrations",
  transport: {
    baseUrl: "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    stallTimeoutMs: 120000,
    usage: {
      url: "https://openapi.qoder.sh/api/v2/quota/usage",
    },
  },
  models: [
    { id: "ultimate", name: "Ultimate" },
    { id: "auto", name: "Auto" },
    { id: "performance", name: "Performance" },
    { id: "efficient", name: "Efficient" },
    { id: "lite", name: "Lite" },
    { id: "qmodel_38max", name: "Qwen3.8-Max" },
    // Qoder recycles these slots without renaming keys — the live catalog
    // (ide-text v1.0.357, 2026-11-11) now publishes qmodel_latest as
    // "Qwen4-Max-Preview" (enable:false but usable — upstream 9router commit
    // 597ee684 confirms) and qmodel_preview as "Qwen3.8-Max-Preview".
    { id: "qmodel_latest", name: "Qwen4-Max-Preview" },
    { id: "qmodel_preview", name: "Qwen3.8-Max-Preview" },
    { id: "qmodel", name: "Qwen3.7-Plus" },
    { id: "qfmodel", name: "Qwen3.8-Flash" },
    { id: "kmodel_latest", name: "Kimi-K3.1-Pro" },
    { id: "kmodel", name: "Kimi-K2.8-Preview" },
    { id: "gmodel", name: "GLM-5.3" },
    { id: "gfmodel", name: "GLM-5.3-Flash" },
    { id: "dmodel", name: "DeepSeek-V4-Pro" },
    { id: "dfmodel", name: "DeepSeek-Flash" },
    { id: "mmodel", name: "MiniMax-M3.1-Flash" },
    // Frontier reasoning pair. Absent from many per-account catalogs, so the
    // executor falls back to a static model_config (see constants.js).
    { id: "smodel", name: "Sonus" },
    { id: "cmodel", name: "Cantus" },
  ],
  oauth: {
    openApiBaseUrl: "https://openapi.qoder.sh",
    centerBaseUrl: "https://center.qoder.sh",
    chatBaseUrl: "https://api3.qoder.sh",
    deviceTokenUrl: "https://openapi.qoder.sh/api/v1/deviceToken/poll",
    refreshUrl: "https://center.qoder.sh/algo/api/v3/user/refresh_token",
    userInfoUrl: "https://openapi.qoder.sh/api/v1/userinfo",
    quotaUsageUrl: "https://openapi.qoder.sh/api/v2/quota/usage",
    loginUrl: "https://qoder.com/device/selectAccounts",
  },
  features: {
    usage: true,
    // PAT (apikey) connections also carry quota usage (via job-token exchange).
    usageApikey: true,
  },
};
