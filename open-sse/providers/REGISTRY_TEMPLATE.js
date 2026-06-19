/**
 * REGISTRY ENTRY TEMPLATE — copy into registry/{id}.js when adding a new provider.
 *
 * NOT imported by registry/index.js (lives outside registry/, static-import list ignores it).
 * Delete every block your provider does not need. Only `id` + `category` are required.
 * Field contract: see schema.js `@typedef RegistryEntry`. Runtime builders: providers/index.js.
 *
 * Quick recipes:
 *   - Plain API-key LLM      → id, alias, category:"apikey", display, transport{baseUrl}, models.
 *   - OAuth LLM (device/PKCE)→ add oauth{...}; clientId/tokenUrl auto-inject into transport.
 *   - Media-only (tts/stt/…) → drop `models`+chat baseUrl, fill media{serviceKinds, *Config}.
 */

// import { CLAUDE_API_HEADERS, GOOGLE_OAUTH_CLIENT, OPENAI_COMPAT_BASE } from "./shared.js";

export default {
  // ── identity ────────────────────────────────────────────────────────────
  id: "example",                 // REQUIRED. kebab-case, unique.
  alias: "ex",                   // short key for PROVIDER_MODELS (defaults to id if omitted).
  aliases: ["example-ai"],       // optional extra lookup tokens.
  uiAlias: "ex",                 // optional UI badge token.
  category: "apikey",            // REQUIRED. "apikey" | "oauth" | "freeTier" | ...

  // ── auth hints (only when relevant) ──────────────────────────────────────
  authType: "apikey",            // "apikey" | "oauth".
  hasOAuth: false,               // true if an OAuth flow exists.
  authModes: ["apikey"],         // e.g. ["oauth","apikey"] when both supported.
  // noAuth: true,               // local/free providers needing no credential.

  // ── UI display ───────────────────────────────────────────────────────────
  display: {
    name: "Example",
    icon: "bolt",                // material icon name OR textIcon fallback.
    color: "#3B82F6",
    textIcon: "EX",
    website: "https://example.com",
    notice: { apiKeyUrl: "https://example.com/keys" }, // or signupUrl.
    // deprecated: true, deprecationNotice: "RISK_NOTICE",
    // kindNotice: { image: "Requires paid plan." },
    // mediaPriority: 1,
  },

  // ── transport (HTTP runtime) → PROVIDERS[id] ─────────────────────────────
  // Defaults applied: format:"openai". Declare ONLY what differs.
  transport: {
    baseUrl: "https://api.example.com/v1/chat/completions",
    format: "openai",            // "openai" | "claude" | "gemini" | "openai-responses" | ...
    // validateUrl: "https://api.example.com/v1/models",
    // headers: { "User-Agent": "..." },           // static fingerprint (anti-ban) lives here.
    // auth: { header: "x-api-key", scheme: "raw" },
    // forceStream: true, urlSuffix: "?beta=true",
    // quirks: { dropOutputConfig: true },
    // retry: { 429: { attempts: 6 }, 503: { attempts: 3 } },
    // usage: { url: "https://api.example.com/usage" }, // or { urls: [...] } for multi-call.
    // modelsFetcher: { url: "https://api.example.com/models", type: "openai" }, // dynamic model list.
    // regions: { sgp: "https://sgp...", cn: "https://cn..." }, defaultRegion: "sgp",
    // NOTE: clientId/clientSecret/tokenUrl are injected from `oauth` — do NOT duplicate here.
  },

  // ── oauth flow → PROVIDER_OAUTH[id] (omit for pure API-key) ───────────────
  // oauth: {
  //   clientId: "app_xxx",
  //   authorizeUrl: "https://auth.example.com/oauth/authorize", // PKCE/code flow.
  //   tokenUrl: "https://auth.example.com/oauth/token",
  //   deviceCodeUrl: "https://auth.example.com/device",          // device-code flow.
  //   refreshUrl: "https://auth.example.com/oauth/token",
  //   scope: "openid profile offline_access",                    // or scopes: [...].
  //   codeChallengeMethod: "S256",
  //   redirectUri: "http://127.0.0.1:1455/auth/callback", fixedPort: 1455, callbackPath: "/auth/callback",
  //   extraParams: { foo: "bar" },
  //   refresh: { encoding: "form", scope: "openid offline_access" }, // "form" | "json".
  //   refreshLeadMs: 300000,
  //   userInfoUrl: "https://example.com/userinfo",
  // },

  // ── media (non-LLM services) → PROVIDER_MEDIA[id] ────────────────────────
  // media: {
  //   serviceKinds: ["llm", "tts", "stt", "embedding", "image", "imageToText", "webSearch"],
  //   ttsConfig:       { baseUrl: "...", authType: "apikey", authHeader: "bearer", format: "openai", defaultModel: "tts-1", models: [{ id: "tts-1", name: "TTS-1" }] },
  //   sttConfig:       { baseUrl: "...", authType: "apikey", authHeader: "bearer", format: "openai", models: [{ id: "whisper-1", name: "Whisper" }] },
  //   embeddingConfig: { baseUrl: "...", authType: "apikey", authHeader: "bearer", models: [{ id: "emb-1", name: "Emb", dimensions: 1536 }] },
  //   imageConfig:     { baseUrl: "https://api.example.com/v1/images/generations" },
  //   searchViaChat:   { defaultModel: "ex-search", pricingUrl: "https://example.com/pricing" },
  //   // hiddenKinds: ["image"],
  // },

  // ── models (omit = no key; [] = explicit empty) ──────────────────────────
  models: [
    { id: "example-large", name: "Example Large" },
    // { id: "example-img", name: "Example Image", type: "image", capabilities: ["text2img"], params: ["size"] },
    // { id: "example-emb", name: "Example Embed", type: "embedding" },
  ],

  // ── optional flags ───────────────────────────────────────────────────────
  // features: { usage: true },
  // thinkingConfig: { options: ["auto", "none", "low", "high"], defaultMode: "auto" },
  // passthroughModels: true,
};
