export default {
  id: "cavoti",
  priority: 70,
  alias: "cavoti",
  aliases: [
    "cv",
  ],
  uiAlias: "CV",
  display: {
    name: "Cavoti AI",
    icon: "hub",
    color: "#0EA5E9",
    textIcon: "CV",
    website: "https://cavoti.com",
    notice: {
      apiKeyUrl: "https://cavoti.com/docs/quickstart",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://cavoti.com/v1/chat/completions",
    validateUrl: "https://cavoti.com/v1/models",
    modelsFetcher: { url: "https://cavoti.com/v1/models", type: "openai" },
  },
  // Marketplace gateway — per-key model allowlist set in Cavoti's dashboard, NOT
  // a fixed catalog. GET /v1/models returns only models this specific key can use.
  // Tested 2026-09-08: key issued from a "free unlimited GLM/DeepSeek/Qwen" promo
  // thread was actually scoped to gpt-5.6-sol only (200 OK, ~3s, correct). The
  // promoted free models were NOT present on the tested key — don't assume a
  // marketing claim maps to what a given key unlocks; always check /v1/models.
};
