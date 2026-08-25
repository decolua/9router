/**
 * Freebuff — the free, ad-supported coding agent by Codebuff (freebuff.com).
 */
const freebuffRegistry = {
  id: "freebuff",
  priority: 45,
  hasFree: true,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
      text: "Free ad-supported coding agent by Codebuff. Sign in with your Freebuff/Codebuff account via browser login. Free tier is ad-supported and limited in some regions (limited mode: 6 x 1-hour sessions/day); full mode runs in select countries. One account has one active session locked to one model.",
    },
  },
  category: "free",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: { "User-Agent": "ai-sdk/openai-compatible/1.0/codebuff" },
    retry: {
      429: { attempts: 2, delayMs: 2000 },
      503: { attempts: 2, delayMs: 1500 },
    },
    usage: { url: "https://www.codebuff.com/api/v1/freebuff/session" },
  },
  features: { usage: true },
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "mimo/mimo-v2.5", name: "MiMo 2.5" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
  ],
  oauth: {
    baseUrl: "https://freebuff.com",
    loginCodePath: "/api/auth/cli/code",
    loginStatusPath: "/api/auth/cli/status",
    oauthTimeoutMs: 300000,
  },
};

export default freebuffRegistry;
