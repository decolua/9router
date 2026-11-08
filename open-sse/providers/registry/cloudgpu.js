export default {
  id: "cloudgpu",
  priority: 65,
  alias: "cloudgpu",
  aliases: [
    "cgpu",
  ],
  uiAlias: "cgpu",
  display: {
    name: "CloudGPU",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "CG",
    website: "https://cloudgpu.app/api?utm_source=github&utm_medium=referral&utm_campaign=202611_seg04_codingagent&utm_content=9router",
    notice: {
      apiKeyUrl: "https://cloudgpu.app/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://cloudgpu.app/v1/chat/completions",
    // GET /v1/models is public, so it cannot tell a bad key from a good one; /v1/gpu/account needs a valid key (401 without).
    validateUrl: "https://cloudgpu.app/v1/gpu/account",
  },
  models: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "minimax-m3", name: "MiniMax M3" },
  ],
};
