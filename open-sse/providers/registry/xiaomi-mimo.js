import { CLAUDE_API_HEADERS } from "../shared.js";

// Dual auth (same pattern as kimi):
//   - API key (sk-...)      → cloud API on api.xiaomimimo.com
//   - Desktop account/OAuth → same cloud host, plus the Desktop-exclusive Preview
//     models served by the account-service route on mimo-server-cn.xiaomimimo.com
//     (authorized by a Xiaomi account session cookie, not the key).
// Endpoint is picked per model in the executor, same as opencode-go's /responses split.
export default {
  id: "xiaomi-mimo",
  priority: 290,
  alias: "xiaomi-mimo",
  aliases: [
    "mimo",
    "mimo-desktop",
    "xmd",
  ],
  uiAlias: "mimo",
  display: {
    name: "Xiaomi MiMo",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "XM",
    website: "https://xiaomimimo.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com/console/api-keys",
      signupUrl: "https://mimo.xiaomimimo.com/desktop/invite/",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  serviceKinds: ["llm", "tts"],
  transport: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    validateUrl: "https://api.xiaomimimo.com/v1/models",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    // Desktop-exclusive — served by the account-service route, which only accepts
    // OpenAI format, so supportedFormats pins them to the openai transport.
    { id: "mimo-x-pro-preview", name: "MiMo-X-Pro-Preview", upstreamModelId: "xiaomi/mimo-x-pro-preview", supportedFormats: ["openai"] },
    { id: "mimo-x-flash-preview", name: "MiMo-X-Flash-Preview", upstreamModelId: "xiaomi/mimo-x-flash-preview", supportedFormats: ["openai"] },
    // Cloud API models (api.xiaomimimo.com/v1)
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
    { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", kind: "tts" },
  ],
  ttsConfig: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    authType: "apikey",
    authHeader: "bearer",
    format: "xiaomi-mimo-tts",
  },
  features: {
    usage: true,
    usageApikey: true,
  },
  // Custom OAuth — non-standard ECDH encrypted-callback flow.
  // Handled by the Xiaomi MiMo OAuth service, not the generic PKCE pipeline.
  oauth: {
    custom: true,
    authorizeUrl: "https://platform.xiaomimimo.com/authorize",
    // The callback carries ?u=<ECDH-encrypted payload> instead of ?code=.
    // Decryption yields { uid, sk, url }.
    callbackParam: "u",
    kn: "mimocode",
  },
};
