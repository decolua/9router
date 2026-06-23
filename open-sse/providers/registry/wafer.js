// OmniRoute claude-format provider (Wafer, Anthropic-compatible, bearer auth).
const wafer = {
  id: "wafer",
  priority: 70,
  alias: "wafer",
  display: {
    name: "Wafer",
    icon: "hub",
    color: "#0891B2",
    textIcon: "WF",
    website: "https://wafer.ai",
    notice: {
      apiKeyUrl: "https://pass.wafer.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://pass.wafer.ai/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    quirks: {},
  },
  models: [
    { id: "DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B" },
    { id: "GLM-5.1", name: "GLM 5.1" },
  ],
};
export default wafer;
