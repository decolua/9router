// TTOken (api.ttoken.dev) — Indonesian pay-per-token AI gateway billed in Rupiah. Keys look like
// `sk-ttoken-v1-*` and are created per product at ttoken.dev/dashboard/keys; only keys made for the
// "Gateway" product (scope `router`) can call these endpoints, other product keys get 403.
// Verified 2026-11-26 against production through a local 9Router (OpenAI Compatible node):
//   GET  https://api.ttoken.dev/v1/models            → 200 (Bearer), key-scoped list, ids `<vendor>/<model>`
//   POST https://api.ttoken.dev/v1/chat/completions  → 200 (Bearer), JSON and SSE, tools, ~208k-token prompts
//
// One lane only: TTOken also serves /v1/messages and /v1/responses, but those are translated to Chat
// Completions server-side and reject image blocks, so letting 9Router translate onto the chat lane
// keeps vision payloads and every client format on the path that was verified end to end.
//
// Model ids carry their own vendor prefix (`deepseek/deepseek-v4.1-flash`), so a full 9Router id is
// `ttoken/deepseek/deepseek-v4.1-flash`; parseModel splits on the first slash. `ttoken/auto` lets
// TTOken pick a model. The seed is the public catalogue's generally available chat models; the
// approval-gated uncensored model is left out, and passthrough forwards anything else the key allows.

export default {
  id: "ttoken",
  priority: 125,
  alias: "ttoken",
  uiAlias: "ttoken",
  display: {
    name: "TTOken",
    icon: "toll",
    color: "#FFB21A",
    textIcon: "TT",
    website: "https://ttoken.dev",
    notice: {
      text: "TTOken gateway (sk-ttoken-v1-* keys, api.ttoken.dev): pay-per-token access to DeepSeek, GLM, Qwen and more, billed in Rupiah. Create a key for the Gateway product; keys for other TTOken products are rejected.",
      apiKeyUrl: "https://ttoken.dev/dashboard/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.ttoken.dev/v1/chat/completions",
    validateUrl: "https://api.ttoken.dev/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "ttoken/auto", name: "TTOken Auto" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B" },
    { id: "netra/deepseek-v4.1-flash-netra", name: "DeepSeek V4.1 Flash (Netra)" },
  ],
  passthroughModels: true,
};
