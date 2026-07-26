/**
 * Frontier for All (frontier-for-all.vercel.app)
 *
 * Source of truth: docs/partners.md in JoddabodScripts/Frontier-for-all.
 *
 * A standard OAuth 2.0 authorization server + OpenAI-compatible inference proxy.
 * The user connects their own provider key on the Frontier dashboard; we never
 * see it and never choose a provider.
 *
 * Three things make this provider unusual:
 *  - The `model` field is IGNORED upstream. Every request runs on whatever model
 *    the user selected for this app on their Frontier dashboard, unless they turn
 *    on "hints" for us — which is off by default and not ours to enable. Hence
 *    `passthroughModels` plus a single `auto` placeholder id: any model id routes,
 *    none of them decide anything. The response echoes what actually ran in
 *    X-Frontier-Model / X-Frontier-Provider.
 *  - Even with hints on, a model id can only move the user within the provider
 *    they already chose (upstream `resolveModel` keeps `provider` and swaps only
 *    `model`; Groq is the fallback adapter). So the catalogue below is only
 *    usable a provider at a time — hence the provider suffix on every name.
 *  - Login is the RFC 8628 device flow. The dashboard runs on an arbitrary
 *    host/port, and Frontier matches redirect URIs exactly with no wildcards, so
 *    the PKCE code flow would need every deployment registered up front.
 */
export default {
  id: "frontier-for-all",
  priority: 15,
  hasFree: true,
  alias: "ffa",
  aliases: ["frontier"],
  uiAlias: "ffa",
  display: {
    name: "Frontier for All",
    icon: "travel_explore",
    color: "#6366F1",
    textIcon: "FF",
    website: "https://frontier-for-all.vercel.app",
    notice: {
      text: "Sign in with your Frontier account via device code. Requests run on the model you picked for 9Router on your Frontier dashboard — the model id sent by the client is ignored unless you turn on \"Let 9Router suggest a model\" there. Limits: 20 req/min, 300 req/hour per token.",
      signupUrl: "https://frontier-for-all.vercel.app",
    },
  },
  category: "freeTier",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://frontier-for-all.vercel.app/api/v1/chat/completions",
    validateUrl: "https://frontier-for-all.vercel.app/api/v1/models",
    // Frontier's own per-token limit (20/min, 300/hour) sits in front of the
    // provider's; 429 always carries Retry-After.
    retry: { 429: { attempts: 3, delayMs: 3000 } },
  },
  // Placeholder id — the real model is the user's dashboard choice (see header).
  models: [{ id: "auto", name: "Frontier Auto (your dashboard model)" }],
  passthroughModels: true,
  // Frontier's hand-curated catalogue (lib/providers/index.ts upstream), offered as
  // one-click additions rather than shipped as `models` above, because naming one of
  // these only does anything once the user turns hints on — see `notice`. Static
  // because Frontier has no public catalogue endpoint: /api/v1/models needs a token
  // and answers with the single model that user picked for us.
  modelsFetcher: {
    type: "static",
    label: "Frontier catalogue — grouped by upstream provider (see the note above)",
    notice:
      "A model id here only does anything when \"Let 9Router suggest a model\" is on — the checkbox on the Frontier consent screen, or Dashboard → Connected apps if you already signed in. Off, Frontier ignores the id and runs your dashboard default, which is what ffa/auto is for. A hint also swaps the model only, never the provider: pick an id from the provider set for 9Router (Groq unless you changed it on the consent screen or in Frontier settings) and make sure that provider's key is connected. An id from any other provider will fail.",
    models: [
      // Groq
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Groq)", contextLength: 131072 },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Groq)", contextLength: 131072 },
      { id: "openai/gpt-oss-120b", name: "GPT OSS 120B (Groq)", contextLength: 131072 },
      { id: "openai/gpt-oss-20b", name: "GPT OSS 20B (Groq)", contextLength: 131072 },
      // Cerebras
      { id: "llama-3.3-70b", name: "Llama 3.3 70B (Cerebras)" },
      { id: "llama3.1-8b", name: "Llama 3.1 8B (Cerebras)" },
      { id: "qwen-3-32b", name: "Qwen 3 32B (Cerebras)" },
      { id: "gpt-oss-120b", name: "GPT OSS 120B (Cerebras)", contextLength: 131072 },
      // Mistral
      { id: "mistral-small-latest", name: "Mistral Small (Mistral)" },
      { id: "mistral-large-latest", name: "Mistral Large (Mistral)" },
      { id: "codestral-latest", name: "Codestral (Mistral)" },
      { id: "magistral-small-latest", name: "Magistral Small (Mistral)" },
      // OpenRouter (free tier)
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B free (OpenRouter)" },
      { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 free (OpenRouter)" },
      { id: "qwen/qwen3-235b-a22b:free", name: "Qwen 3 235B free (OpenRouter)" },
      { id: "google/gemma-3-27b-it:free", name: "Gemma 3 27B free (OpenRouter)" },
    ],
  },
  oauth: {
    // 9Router's registered public client. Registered as a command line tool, so
    // there is no redirect URI and no client secret — a public client must not
    // hold one, and the device grant is what binds the authorization.
    clientId: "07b329d7-59a0-429d-8037-0f036b7b1efb",
    deviceCodeUrl: "https://frontier-for-all.vercel.app/device/code",
    deviceTokenUrl: "https://frontier-for-all.vercel.app/device/token",
    tokenUrl: "https://frontier-for-all.vercel.app/token",
    refreshUrl: "https://frontier-for-all.vercel.app/token",
    revokeUrl: "https://frontier-for-all.vercel.app/revoke",
    modelsUrl: "https://frontier-for-all.vercel.app/api/v1/models",
    scope: "inference",
    refreshLeadMs: 5 * 60 * 1000,
  },
};
