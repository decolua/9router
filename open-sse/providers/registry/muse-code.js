/**
 * Muse Code CLI (Meta) — Meta's terminal coding agent built on Muse Spark.
 *
 * Wire format: OpenAI Responses API (POST /v1/responses). Muse CLI launches with
 * `META_API_KEY=... muse --provider meta --base-url <router>/v1` and discovers
 * models via the proprietary catalog GET /v1/muse-code/models (served locally by
 * src/app/api/v1/muse-code/models/route.js).
 *
 * Auth: `Authorization: Bearer <META_API_KEY>`.
 * Reasoning: Muse sends xhigh/ultra efforts — normalized downstream (see translator).
 * Model list: verified via official Meta Model API /v1/models (issue #9544 capture).
 */
export default {
  id: "muse-code",
  priority: 220,
  alias: "mc",
  aliases: ["muse", "meta"],
  uiAlias: "mc",
  display: {
    name: "Muse Code (Meta)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MC",
    website: "https://dev.meta.ai",
    notice: {
      text: "Meta Model API key (META_API_KEY). Supports Muse Spark via the Responses API. Get a key at dev.meta.ai — pick Muse Code (muse-spark-1.2) as the model.",
      apiKeyUrl: "https://dev.meta.ai",
      signupUrl: "https://dev.meta.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  thinkingConfig: {
    options: ["low", "medium", "high", "xhigh", "ultra"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://api.meta.ai/v1/responses",
    format: "openai-responses",
    forceStream: true,
    modelsUrl: "https://api.meta.ai/v1/models",
  },
  transports: [
    { format: "openai-responses", baseUrl: "https://api.meta.ai/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  models: [
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", contextLength: 1048576, maxOutputTokens: 131072, supportsReasoning: true },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 (Contributor)", contextLength: 1048576, maxOutputTokens: 131072, supportsReasoning: true },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", contextLength: 1048576, maxOutputTokens: 131072, supportsReasoning: true },
  ],
  features: {
    usage: false,
  },
};