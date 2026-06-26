export default {
  id: "qwen",
  hidden: true,
  priority: 130,
  alias: "qw",
  display: {
    name: "Qwen Code",
    icon: "psychology",
    color: "#10B981",
    website: "https://chat.qwen.ai",
    notice: {
      signupUrl: "https://chat.qwen.ai",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://portal.qwen.ai/v1/chat/completions",
  },
  models: [
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "vision-model", name: "Qwen3 Vision Model" },
    { id: "coder-model", name: "Qwen3.6 Coder Model" },
  ],
  oauth: {
    clientId: "f0304373b74a44d2b584a3fb70ca9e56",
    deviceCodeUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code",
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
    scope: "openid profile email model.completion",
    codeChallengeMethod: "S256",
    refreshLeadMs: 1200000,
  },
};
