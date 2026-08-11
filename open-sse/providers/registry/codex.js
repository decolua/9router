import { withCodexReviewModels } from "../models/helpers.js";

export default {
  id: "codex",
  priority: 30,
  alias: "cx",
  uiAlias: "cx",
  display: {
    name: "OpenAI Codex",
    icon: "code",
    color: "#3B82F6",
    website: "https://chatgpt.com/codex",
    notice: {
      signupUrl: "https://chatgpt.com/codex",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
    kindNotice: {
      image: "Requires a ChatGPT Plus (or higher) account. Free accounts are not supported for image generation.",
    },
  },
  category: "oauth",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    format: "openai-responses",
    forceStream: true,
    headers: {
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.136.0",
    },
    usage: {
      url: "https://chatgpt.com/backend-api/wham/usage",
      resetCreditsUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      resetCreditsConsumeUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
    },
  },
  models: [
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    // `review` is a mode, and `quotaFamily` beside it is a different axis again:
    // one says how the model behaves, the other which quota it draws from.
    { id: "gpt-5.6-sol-review", name: "GPT 5.6 Sol Review", upstreamModelId: "gpt-5.6-sol", quotaFamily: "review", family: "gpt-5.6-sol", mode: "review" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "gpt-5.6-terra-review", name: "GPT 5.6 Terra Review", upstreamModelId: "gpt-5.6-terra", quotaFamily: "review", family: "gpt-5.6-terra", mode: "review" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.6-luna-review", name: "GPT 5.6 Luna Review", upstreamModelId: "gpt-5.6-luna", quotaFamily: "review", family: "gpt-5.6-luna", mode: "review" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.5-review", name: "GPT 5.5 Review", upstreamModelId: "gpt-5.5", quotaFamily: "review", family: "gpt-5.5", mode: "review" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.4-review", name: "GPT 5.4 Review", upstreamModelId: "gpt-5.4", quotaFamily: "review", family: "gpt-5.4", mode: "review" },
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gpt-5.4-mini-review", name: "GPT 5.4 Mini Review", upstreamModelId: "gpt-5.4-mini", quotaFamily: "review", family: "gpt-5.4-mini", mode: "review" },
    // Spark is its OWN upstream model - the review entry below points at it, not at
    // gpt-5.3-codex - so it must not borrow gpt-5.3-codex's band the way substring
    // matching used to give it. Left undeclared on purpose: it needs its own bench
    // entry, and until it has one the tuner reports it as unbanded every run.
    { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark" },
    { id: "gpt-5.3-codex-spark-review", name: "GPT 5.3 Codex Spark Review", upstreamModelId: "gpt-5.3-codex-spark", quotaFamily: "review", mode: "review" },
    { id: "gpt-5.5-image", name: "GPT 5.5 Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.4-image", name: "GPT 5.4 Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.3-image", name: "GPT 5.3 Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
  ],
  serviceKinds: ["llm","image"],
  oauth: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
    codeChallengeMethod: "S256",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
    extraParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    },
    refreshLeadMs: 432000000,
    refresh: {
      encoding: "form",
      scope: "openid profile email offline_access",
    },
    maxRefreshAgeMs: 691200000,
    trackRefreshAt: true,
  },
  features: {
    usage: true,
  },
};
