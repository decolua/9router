export default {
  id: "dothoosh",
  priority: 120,
  alias: "dothoosh",
  aliases: [
    "dh",
  ],
  uiAlias: "dothoosh",
  display: {
    name: "DotHoosh",
    icon: "lightbulb",
    color: "#F4600C",
    textIcon: "DH",
    website: "https://gateway.dothoosh.com",
    notice: {
      text: "DotHoosh: Iranian AI gateway, OpenAI- and Anthropic-compatible, billed in Toman (IRT) from a prepaid wallet. One API key reaches every model; ids are bare and the model list is fetched live per key.",
      apiKeyUrl: "https://gateway.dothoosh.com/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // Default lane: OpenAI Chat Completions. `thinkingFormat` is deliberately
    // NOT declared, so each model resolves its own wire format through
    // providers/capabilities.js.
    baseUrl: "https://gateway.dothoosh.com/v1/chat/completions",
    validateUrl: "https://gateway.dothoosh.com/v1/models",
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. DotHoosh serves all three protocols with one key, but verifies each
  // protocol per model, so `supportedFormats` guards each lane (chatCore).
  // The Anthropic lane accepts ONLY x-api-key (sending Authorization as well is
  // rejected) and pins anthropic-version to 2023-06-01; no beta headers are sent.
  transports: [
    { format: "openai", baseUrl: "https://gateway.dothoosh.com/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://gateway.dothoosh.com/anthropic/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://gateway.dothoosh.com/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  // No static model list. The catalog is DotHoosh's public GET /v1/models plus GET
  // /anthropic/v1/models (no key needed; with a key each narrows to that key's models). Keyless
  // suggestions use `modelsFetcher` on the worldwide mirror (www.dothoosh.com/gateway, behind
  // Cloudflare), because the Iran-hosted API is not reachable from outside Iran; the
  // per-connection import (api/providers/[id]/models) uses the key on gateway.dothoosh.com. Any
  // id passes via passthroughModels. Which protocol lane a model is served on comes from the
  // listing's protocols[] (providers/models/dothooshLive.js, refreshed by the server), with the
  // name-based table in providers/models/helpers.js only as a fallback.
  modelsFetcher: [
    { url: "https://www.dothoosh.com/gateway/v1/models", type: "openai" },
    { url: "https://www.dothoosh.com/gateway/anthropic/v1/models", type: "anthropic" },
  ],
  passthroughModels: true,
};
