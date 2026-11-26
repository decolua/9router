// OpenDesign Go — subscription gateway at amr-link.open-design.ai ("corouter").
// Vendor-verified 2026-11-11 from https://go.open-design.ai (setup tabs + model pages):
//   OpenAI  POST https://amr-link.open-design.ai/v1/chat/completions   → 401 missing_api_key
//   Claude  POST https://amr-link.open-design.ai/v1/messages           → 401 authentication_error
//   Responses POST https://amr-link.open-design.ai/v1/responses        → 401 missing_api_key
// All three lanes exist (each answers with its own protocol's auth error, never 404),
// and /v1/messages reads either `x-api-key` or `Authorization: Bearer`; Bearer is used
// everywhere because the other two lanes accept nothing else.
// Model ids are dotted versions (`deepseek-v4.1-flash`, `claude-haiku-5.5`) — the exact
// `id` in each model page's `data-model` blob, not the hyphenated URL slug.

export default {
  id: "opendesign-go",
  priority: 118,
  alias: "opendesign-go",
  aliases: [
    "odg",
    "opendesign",
  ],
  uiAlias: "odg",
  display: {
    name: "OpenDesign Go",
    icon: "design_services",
    // Sampled from public/providers/opendesign.png (the vendor mark is this violet).
    color: "#733CEB",
    textIcon: "OD",
    website: "https://go.open-design.ai",
    notice: {
      text: "OpenDesign Go subscription (Go: $8 first month, then $10/mo). One key reaches DeepSeek, GLM, Kimi, MiMo, Qwen, GPT, Claude, Gemini and Grok over the OpenAI, Anthropic and Responses wires.",
      apiKeyUrl: "https://open-design.ai/cloud/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://amr-link.open-design.ai/v1/chat/completions",
    validateUrl: "https://amr-link.open-design.ai/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    // Time-to-headers grows with prompt size: measured 2s (empty), 7s (150 KB), 11–37s
    // (800 KB / 262 tools), and 20–55s TTFT on live ~400k-token cached sessions. The global
    // 60s header timeout aborted the slow tail, then the default 502 policy (3 retries × 3s)
    // re-uploaded the whole prompt each time — every failure in the log took ~189.5s
    // (3 × 60s + 3 × 3s) and locked the single account for 30s. Wait longer, retry once.
    timeoutMs: 180000,
    retry: { 502: { attempts: 1, delayMs: 2000 } },
    // Quota lives on a different host and a different credential: amr-api is the
    // control plane, reached with the `vela_ctrl_...` key (not the sk-amr runtime
    // key), and the workspace id is appended before /billing/preflight.
    usage: { url: "https://amr-api.open-design.ai/api/v1/workspaces" },
  },
  features: {
    usage: true,
    usageApikey: true,
  },
  // Multi-endpoint: match the client's sourceFormat so no lossy translation runs.
  // No per-model `supportedFormats`: the vendor documents all three tabs (Codex →
  // /responses, Claude Code → /messages, anything OpenAI → /chat/completions)
  // against the same catalogue, and which ids each lane actually serves has not
  // been probed with a real key.
  transports: [
    { format: "openai", baseUrl: "https://amr-link.open-design.ai/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://amr-link.open-design.ai/v1/messages", auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://amr-link.open-design.ai/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  // Catalogue read from the Go model table on 2026-11-11. /v1/models needs the key and
  // the dashboard's modelsFetcher proxy sends none, so this list is the seed and
  // passthroughModels covers any account-specific id added later.
  models: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)" },
    { id: "glm-5.3-flashx", name: "GLM-5.3 Flash-X" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "hy4-preview", name: "Hy4 Preview" },
    { id: "gpt-6.1-sol", name: "GPT 6.1 Sol" },
    { id: "gpt-6-sol", name: "GPT 6 Sol" },
    { id: "gpt-6-astra", name: "GPT 6 Astra" },
    { id: "gpt-6-luna", name: "GPT 6 Luna" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "claude-fable-5.1", name: "Claude Fable 5.1" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "grok-4.7", name: "Grok 4.7" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "grok-4.5", name: "Grok 4.5" },
  ],
  passthroughModels: true,
};
