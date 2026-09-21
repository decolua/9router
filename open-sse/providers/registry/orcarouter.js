import { ORCAROUTER_SEED_MODELS, ORCAROUTER_ID } from "../orcarouterCatalog.js";

// Inference + model discovery live on the relay origin; `/v1` is the only suffix
// this provider appends. Authentication is a different origin — see the `oauth`
// block below and open-sse/providers/orcarouterCatalog.js.
const API_BASE = "https://api.orcarouter.ai/v1";

export default {
  id: ORCAROUTER_ID,
  priority: 20,
  alias: "orca",
  aliases: ["orcarouter", "orca-router"],
  uiAlias: "orcarouter",
  display: {
    name: "OrcaRouter",
    icon: "hub",
    color: "#6366F1",
    textIcon: "OR",
    website: "https://www.orcarouter.ai",
    notice: {
      text: "OpenAI-compatible AI gateway that routes many providers behind one endpoint. Pick an API key or sign in with OrcaRouter.",
      apiKeyUrl: "https://www.orcarouter.ai",
    },
  },
  category: "oauth",
  authType: "apikey",
  // Both auth methods are first-class: a pasted sk-orca-… key, or a PKCE login
  // that issues the same kind of key. See src/lib/oauth/providers/orcarouter.js.
  authModes: ["apikey", "oauth"],
  hasOAuth: true,
  authHint: "sk-orca-…",
  hasProviderSpecificData: true,
  transport: {
    baseUrl: `${API_BASE}/chat/completions`,
    validateUrl: `${API_BASE}/models`,
    format: "openai",
  },
  // Authorize/exchange only. `tokenUrl` is the code-exchange endpoint, NOT a
  // refresh endpoint: the PKCE flow returns a durable API key and OrcaRouter
  // publishes no refresh grant, so a revoked key must reauthenticate rather
  // than refresh (see open-sse/services/tokenRefresh.js).
  oauth: {
    authorizeUrl: "https://www.orcarouter.ai/auth",
    tokenUrl: "https://www.orcarouter.ai/api/v1/auth/keys",
    codeChallengeMethod: "S256",
    scope: "api",
    redirectUri: "oob",
    callbackPath: "/callback",
  },
  // Cold-start only. Replaced by the live catalog (GET {apiBase}/models) as soon
  // as it answers; kept so a fresh install or a catalog outage still has models.
  models: ORCAROUTER_SEED_MODELS.map((m) => ({ id: m.id, name: m.name })),
  serviceKinds: ["llm", "embedding", "image", "video"],
  embeddingConfig: {
    baseUrl: `${API_BASE}/embeddings`,
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: `${API_BASE}/images/generations`,
  },
  videoConfig: {
    baseUrl: `${API_BASE}/videos`,
  },
  modelsFetcher: { url: `${API_BASE}/models`, type: "orcarouter" },
  passthroughModels: true,
};
