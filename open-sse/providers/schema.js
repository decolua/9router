// Provider transport schema: shared defaults + endpoint defaults + resolver (skeleton, not wired)
import { DEFAULT_RETRY_CONFIG, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

/**
 * RegistryEntry shape — full contract for registry/{id}.js. See REGISTRY_TEMPLATE.js for a worked example.
 * Only `id` + `category` are strictly required; everything else is optional/derived.
 *
 * @typedef {Object} RegistryEntry
 * @property {string}   id            Unique provider id (kebab-case). REQUIRED.
 * @property {string}  [alias]        Short key for PROVIDER_MODELS (defaults to id).
 * @property {string[]}[aliases]      Extra lookup tokens resolving to this provider.
 * @property {string}  [uiAlias]      Token shown in UI badges.
 * @property {string}   category      "apikey"|"oauth"|"freeTier"|... drives UI grouping. REQUIRED.
 * @property {string}  [authType]     "apikey"|"oauth" auth hint.
 * @property {string[]}[authModes]    Allowed auth modes when provider supports both.
 * @property {boolean} [hasOAuth]     Provider exposes an OAuth flow.
 * @property {boolean} [noAuth]       Provider needs no credentials (local/free).
 * @property {Object}  [display]      UI: {name,icon,color,textIcon,website,notice,deprecated,deprecationNotice,kindNotice,mediaPriority}.
 * @property {Object}  [transport]    Runtime HTTP config (see TransportConfig below). Builds PROVIDERS[id].
 * @property {Object}  [oauth]        OAuth flow config (see OAuthConfig). Builds PROVIDER_OAUTH[id].
 * @property {Object}  [media]        Non-LLM services (see MediaConfig). Builds PROVIDER_MEDIA[id].
 * @property {Array}   [models]       Model list; omit = no model key, [] = explicit empty.
 * @property {Object}  [features]     Feature flags, e.g. {usage:true}.
 * @property {Object}  [thinkingConfig] Reasoning UI: {options:[...],defaultMode}.
 * @property {boolean} [passthroughModels] Forward client model id untouched.
 *
 * TransportConfig: { baseUrl, format, headers, auth, forceStream, urlSuffix, quirks, retry, timeoutMs,
 *   executor, clientId, clientSecret, tokenUrl, refreshUrl, usage, cliVersion, apiClient, regions,
 *   defaultRegion, modelsFetcher, validateUrl, responsesUrl } — clientId/clientSecret/tokenUrl are
 *   injected from `oauth` automatically (single source); declare them in `oauth`, not here.
 *
 * OAuthConfig: { clientId, authorizeUrl, tokenUrl, deviceCodeUrl, refreshUrl, scope|scopes, redirectUri,
 *   callbackPath, fixedPort, codeChallengeMethod, extraParams, refresh:{encoding,scope}, refreshLeadMs,
 *   userInfoUrl }.
 *
 * MediaConfig: { serviceKinds:[...], ttsConfig, sttConfig, embeddingConfig, imageConfig,
 *   searchViaChat:{defaultModel,pricingUrl}, hiddenKinds } — each *Config: {baseUrl,authType,authHeader,
 *   format,defaultModel,models:[{id,name,dimensions?}]}.
 */

// Shared transport defaults — provider only overrides fields that differ.
// NOTE: runtime (index.js buildTransport) only re-applies `format`; the rest documents the contract
// and feeds the (currently unwired) resolveProvider(). Adding keys here does NOT change PROVIDERS.
export const PROVIDER_DEFAULTS = {
  baseUrl: "",
  format: "openai",
  headers: {},
  auth: { header: "Authorization", scheme: "bearer", source: ["accessToken", "apiKey"] },
  forceStream: false,
  urlSuffix: "",
  quirks: {},
  passthroughModels: false,
  retry: DEFAULT_RETRY_CONFIG,
  timeoutMs: FETCH_CONNECT_TIMEOUT_MS,
  executor: "default"
};

// Default endpoints per format (provider only overrides what differs)
export const ENDPOINT_DEFAULTS = {
  openai: { chat: "/chat/completions", test: "/models", models: "/models" },
  claude: { chat: "/messages", test: "/models", countTokens: "/messages/count_tokens" },
  gemini: { chat: "/{model}:streamGenerateContent", models: "/models", test: "/models" }
};

// Deep-merge a provider entry over PROVIDER_DEFAULTS (defensive for missing transport)
export function resolveProvider(entry) {
  const transport = (entry && entry.transport) || {};
  return {
    ...PROVIDER_DEFAULTS,
    ...transport,
    headers: { ...PROVIDER_DEFAULTS.headers, ...transport.headers },
    auth: { ...PROVIDER_DEFAULTS.auth, ...transport.auth },
    quirks: { ...PROVIDER_DEFAULTS.quirks, ...transport.quirks },
    retry: { ...PROVIDER_DEFAULTS.retry, ...transport.retry }
  };
}
