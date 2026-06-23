// OmniRoute trae provider — Trae solo_agent_remote (solo.trae.ai). OAuth/JWT.
// The TraeExecutor (open-sse/executors/trae.js) owns chat + token refresh
// (Cloud-IDE-JWT + ExchangeToken). NOTE: the OAuth LOGIN flow (capturing the
// initial JWT via solo.trae.ai authorize) is a trae-specific oauth route not
// co-located in the registry — chat works once credentials (accessToken=JWT +
// providerSpecificData identity fields) exist; the login flow is a follow-up.
const trae = {
  id: "trae",
  priority: 70,
  alias: "tr",
  display: {
    name: "Trae",
    color: "#FF6B35",
    textIcon: "TR",
    website: "https://solo.trae.ai",
  },
  category: "oauth",
  hidden: true,
  transport: {
    baseUrl: "https://core-normal.trae.ai/api/remote/v1",
    format: "openai",
  },
  models: [
    { id: "auto", name: "Auto (Code · Server Picks)" },
    { id: "work", name: "Work (Auto · fast)" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-flash-solo", name: "Gemini 3 Flash" },
    { id: "minimax-m3", name: "MiniMax M3", contextLength: 1048576 },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.2", name: "GPT 5.2" },
  ],
};
export default trae;
