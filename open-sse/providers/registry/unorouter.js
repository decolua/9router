export default {
  id: "unorouter",
  priority: 70,
  alias: "unorouter",
  aliases: [
    "uno",
  ],
  uiAlias: "UNO",
  display: {
    name: "UnoRouter",
    icon: "route",
    color: "#7C3AED",
    textIcon: "UN",
    website: "https://unorouter.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unorouter.com/v1/chat/completions",
    validateUrl: "https://api.unorouter.com/v1/models",
    modelsFetcher: { url: "https://api.unorouter.com/v1/models", type: "openai" },
  },
  // 229 models total (89 :free-tier as of 2026-09-08); dynamic fetcher above keeps
  // the list current instead of hand-maintaining models[] here.
  // Free-tier picks (benchmarked 2026-09-08, see scripts/benchmarkFreeModels.mjs):
  //   glm-5.3:free        — recommended default (1.9s, 1M ctx, clean output)
  //   gpt-oss-120b:free   — fastest (1.0s, Groq-backed)
  // Free tier is rate-limited to ~1 req/min/model per account.
};
