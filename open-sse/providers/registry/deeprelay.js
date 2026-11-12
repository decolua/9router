// DeepRelay (api.deeprelay.ai) — multi-vendor gateway billed per token, keys look like
// `deeprelay_*`. Live-verified 2026-11-11 with a real key:
//   GET  https://api.deeprelay.ai/v1/models            → 200, key-scoped catalogue, ids `deeprelay/<model>`
//   POST https://api.deeprelay.ai/v1/chat/completions  → 200 (Bearer)
//   POST https://api.deeprelay.ai/v1/messages          → 200 (x-api-key or Bearer)
//   POST https://api.deeprelay.ai/v1/responses         → 200 (Bearer)
// Bare ids (`deepseek-v4.1-flash`) are accepted on every lane and echoed back as
// `deeprelay/deepseek-v4.1-flash`, so the seed uses bare ids and passthrough forwards the rest.
//
// Not to be confused with deeprelayapi.cloud: a different new-api deployment with `sk-dr*` keys.
// A `deeprelay_*` key there returns 401 new_api_error "Invalid token", which is exactly how the
// previous registry entry (pointed at that host) failed while a manual Anthropic-compatible
// provider on api.deeprelay.ai worked with the same key.
//
// The live catalogue mixes chat, image, video and embedding models; only chat-capable ids are
// seeded below (image/video/embedding ids return non-chat payloads on /chat/completions).

export default {
  id: "deeprelay",
  priority: 124,
  alias: "deeprelay",
  aliases: ["dr", "relay"],
  uiAlias: "dr",
  display: {
    name: "DeepRelay",
    icon: "hub",
    // Sampled from public/providers/deeprelay.png: the mark sits on a near-black
    // tile with pink/gold/cyan chevrons; the cyan chevron is the accent used here.
    color: "#4CC6F2",
    textIcon: "DR",
    website: "https://deeprelay.ai",
    notice: {
      text: "DeepRelay gateway (deeprelay_* keys, api.deeprelay.ai): pay-per-token access to DeepSeek, Kimi, GLM, Qwen, MiniMax and more over the OpenAI, Anthropic and Responses wires. GET /v1/models lists exactly what your key can call.",
      apiKeyUrl: "https://deeprelay.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.deeprelay.ai/v1/chat/completions",
    validateUrl: "https://api.deeprelay.ai/v1/models",
    // Wallet balance (live-probed 2026-11-11: balance_cents 445 + burn rate). The spend
    // history (/v1/usage?bucket=day) is fetched best-effort by the handler itself.
    usage: {
      url: "https://api.deeprelay.ai/v1/billing/balance",
    },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Multi-endpoint: match the client's sourceFormat so no translation runs.
  transports: [
    { format: "openai", baseUrl: "https://api.deeprelay.ai/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://api.deeprelay.ai/v1/messages", auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://api.deeprelay.ai/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  models: [
    // Chat-capable ids from the live key-scoped catalogue (2026-11-11).
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "qwen3.8-max", name: "Qwen 3.8 Max" },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash" },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
    { id: "qwen3.5-9b", name: "Qwen 3.5 9B" },
    { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash" },
    { id: "muse-spark-open-816b-a42b", name: "Muse Spark Open 816B-A42B" },
    { id: "muse-glimmer-30b", name: "Muse Glimmer 30B" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
