import { AUTOCLAW_CHAT_COMPLETIONS_URL, AUTOCLAW_MODEL_MAP, AUTOCLAW_WALLET_URL } from "../../shared/autoclaw.js";

export default {
  id: "autoclaw",
  priority: 35,
  alias: "ac",
  uiAlias: "ac",
  display: {
    name: "AutoClaw",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "AC",
    website: "https://autoclaw.z.ai",
    notice: {
      signupUrl: "https://autoclaw.z.ai",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  hasOAuth: true,
  transport: {
    baseUrl: AUTOCLAW_CHAT_COMPLETIONS_URL,
    format: "openai",
    forceStream: true,
    headers: {},
    auth: { combined: true, header: "X-Authorization", scheme: "bearer" },
    usage: {
      url: AUTOCLAW_WALLET_URL,
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2 (AutoClaw)", upstreamModelId: AUTOCLAW_MODEL_MAP["glm-5.2"] },
    { id: "glm-5-turbo", name: "GLM 5 Turbo (AutoClaw)", upstreamModelId: AUTOCLAW_MODEL_MAP["glm-5-turbo"] },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (AutoClaw)", upstreamModelId: AUTOCLAW_MODEL_MAP["deepseek-v4-pro"] },
    { id: "deepseek-v4", name: "DeepSeek V4 (AutoClaw)", upstreamModelId: AUTOCLAW_MODEL_MAP["deepseek-v4"] },
    { id: "auto", name: "Auto (AutoClaw)", upstreamModelId: AUTOCLAW_MODEL_MAP.auto },
  ],
  features: {
    usage: true,
  },
};
