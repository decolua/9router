// Synthetic (synthetic.new) — subscription gateway, Go plan $9/mo with credits that
// regenerate through the week rather than only on a 5-hour reset.
// Vendor-verified 2026-11-11 by live probe:
//   GET   https://api.synthetic.new/v1/models                       → 200, public (13 ids)
//   POST  https://api.synthetic.new/v1/chat/completions             → 401 needs `Authorization`
//   POST  https://api.synthetic.new/anthropic/v1/messages           → 401, reads x-api-key or Bearer
//   POST  https://api.synthetic.new/v1/responses                    → 404, no Responses lane
// Bearer is used on both lanes: it is the only header the OpenAI lane accepts and the
// Anthropic lane takes it too. `anthropic-version` is sent on the Claude lane.
// Model ids are namespaced (`syn:` plan-routed, `infinite:` pay-as-you-go, `hf:` pinned
// Hugging Face weights) and must reach upstream verbatim — hence passthroughModels.

export default {
  id: "synthetic",
  priority: 122,
  alias: "synthetic",
  aliases: [
    "syn",
  ],
  uiAlias: "syn",
  display: {
    name: "Synthetic",
    icon: "science",
    // The vendor mark (public/providers/synthetic.png) is a monochrome line
    // flower, so the tile keeps a neutral graphite rather than a brand hue.
    color: "#334155",
    textIcon: "SY",
    website: "https://synthetic.new",
    notice: {
      text: "Synthetic subscription (Go: $9/mo). Credits regenerate gradually through the week. DeepSeek, GLM, Kimi, Qwen and GPT-OSS over the OpenAI and Anthropic wires.",
      apiKeyUrl: "https://synthetic.new/settings/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://api.synthetic.new/v1/chat/completions",
    validateUrl: "https://api.synthetic.new/v1/models",
    // Subscription/search request buckets + the weekly credit pool.
    // Live-probed 2026-11-11 (Bearer): subscription.limit 500, search.hourly.limit 250,
    // planWeeklyLimit.percentRemaining — all below /v2, not /v1.
    usage: {
      url: "https://api.synthetic.new/v2/quotas",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  transports: [
    // Every id in the vendor catalogue publishes `reasoning_parameters.efforts`, the
    // OpenAI `reasoning_effort` enum, so the Chat lane takes the openai thinking shape
    // for all of them instead of each backend's native `thinking` object — same call
    // the nvidia override makes in capabilities.js. The Claude lane declares no
    // thinkingFormat, so it keeps resolving per model from capabilities.
    { format: "openai", baseUrl: "https://api.synthetic.new/v1/chat/completions", thinkingFormat: "openai", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://api.synthetic.new/anthropic/v1/messages", auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true } },
  ],
  // Seed snapshot of the public /v1/models (2026-11-11). `syn:*` ids are plan-routed
  // aliases whose backend model changes, so their names stay generic on purpose.
  // Limits are not declared here: models.dev lists provider "synthetic" under these
  // exact ids, so the synced catalog overlay publishes them.
  models: [
    { id: "syn:large:text", name: "Synthetic Large (text)" },
    { id: "syn:small:text", name: "Synthetic Small (text)" },
    { id: "syn:large:vision", name: "Synthetic Large (vision)" },
    { id: "syn:small:vision", name: "Synthetic Small (vision)" },
    { id: "infinite:small:vision", name: "DeepSeek V4.1 Flash 10/17 (Infinite)" },
    { id: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 10/17" },
    { id: "hf:zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "hf:zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "hf:zai-org/GLM-4.7-Flash", name: "GLM 4.7 Flash" },
    { id: "hf:moonshotai/Kimi-K3", name: "Kimi K3" },
    { id: "hf:moonshotai/Kimi-K3.1-Pro", name: "Kimi K3.1 Pro" },
    { id: "hf:Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B" },
    { id: "hf:openai/gpt-oss-120b", name: "GPT-OSS-120B" },
  ],
  // Public catalogue, so the keyless modelsFetcher proxy can read it.
  modelsFetcher: { url: "https://api.synthetic.new/v1/models", type: "synthetic" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
