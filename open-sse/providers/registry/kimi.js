import { CLAUDE_API_HEADERS } from "../shared.js";

// Dual auth (same pattern as xai): OAuth = Kimi Code subscription (device code),
// API key = platform.moonshot / api.kimi.com. Transport is shared.
// CLIProxyAPI parity: client_id, auth.kimi.com device+token, X-Msh-* headers, device_id.
export default {
  id: "kimi",
  priority: 170,
  alias: "kimi",
  // Legacy id + short alias from former kimi-coding registry entry
  aliases: ["kimi-coding", "kmc"],
  display: {
    name: "Kimi",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://kimi.moonshot.cn",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
      signupUrl: "https://www.kimi.com/code",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.kimi.com/coding/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      hooks: ["kimiHeaders"],
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.kimi.com/coding/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["kimiHeaders"] },
    },
    {
      format: "claude",
      baseUrl: "https://api.kimi.com/coding/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw", hooks: ["kimiHeaders"] },
    },
  ],
  models: [
    // Flagship K3 — platform.kimi.ai id `kimi-k3`, Kimi Code OAuth id `k3` (up to 1M)
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "k3", name: "Kimi K3 (Code)" },
    // Kimi Code subscription stable ids (map to K2.7 Code backend)
    { id: "kimi-for-coding", name: "Kimi for Coding" },
    { id: "kimi-for-coding-highspeed", name: "Kimi for Coding Highspeed" },
    // Pay-as-you-go platform ids
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code Highspeed" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  serviceKinds: ["llm", "webSearch"],
  searchViaChat: {
    defaultModel: "kimi-k3",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    pricingUrl: "https://platform.kimi.ai/docs/pricing/chat",
  },
  oauth: {
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    // CLIProxyAPI refreshThresholdSeconds = 300
    refreshLeadMs: 300000,
    authorizeDeviceUrl: "https://www.kimi.com/code/authorize_device",
  },
  features: {
    usage: true,
  },
};
