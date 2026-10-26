export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  // LIVE PROBE (2026-09-17): the credentialless path only works from OpenCode's
  // own client. GET /zen/v1/models answers 200 (so the provider LOOKS healthy),
  // but POST /zen/v1/responses answers 403 FreeTierError "OpenCode's free tier
  // can only be used from within OpenCode" even when the request carries
  // OpenCodeExecutor's own header set, and /zen/v1/chat/completions answers
  // 401 "Missing API key.". A working model list therefore does NOT make the
  // provider usable from this process.
  requiresVendorClient: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    // NOTE (fork): upstream v0.5.81 declares `forceStream: true` here. In the fork
    // that flag is REDUNDANT (chatCore's forced-SSE→JSON hook already detects
    // translator-forced streaming via finalBody.stream) and HARMFUL: it flips
    // internal `stream` to true for stream:false requests to JSON-native
    // upstreams, breaking DF-9ROUTER-11/16's pinned wire contract. Removed at
    // the v0.5.81 merge; revisit if upstream's executor path changes.
    noAuth: true,
    // Zen reasoning models reject multi-turn history whose assistant messages
    // carry no reasoning_content (400 missing_required_parameter), and the
    // response pipeline strips the field before it reaches the client, so the
    // echo can never come from the client. Inject a placeholder instead.
    reasoningInject: {
      scope: "all",
    },
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
      // The free lane's MiMo route (OpenRouter-backed) streams thinking as
      // `reasoning` + `reasoning_details[]`, not reasoning_content. stream.js lifts
      // the alias into reasoning_content for OpenAI-shaped clients; every other
      // model on the lane already emits reasoning_content, so the lift is a no-op.
      reasoningAliasFields: true,
    },
  },
  models: [
    // Endpoint formats differ per model, so declare non-chat models explicitly.
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
    { id: "jev-1.13-free", name: "Jev 1.13 Free", kind: "systemone" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    headers: {
      "x-opencode-client": "desktop",
      "User-Agent": "opencode/1.18.31",
    },
  },
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
