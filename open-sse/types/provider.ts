import type { JsonValue } from './executor.js';
import type { Format } from './formats.js';

// open-sse/types/provider.ts
// Anchors: open-sse/providers/schema.js
//   - @typedef RegistryEntry (lines 8-26)
//   - PROVIDER_DEFAULTS (lines 44-56): transport shape
//   - ENDPOINT_DEFAULTS (lines 59-63): endpoint shape per format
//
// TransportConfig.format and MediaServiceConfig.format use `Format` (from ./formats.js).

// ---------------------------------------------------------------------------
// Sub-interfaces referenced by RegistryEntry
// ---------------------------------------------------------------------------

/** UI display configuration block (schema.js line 18). */
export interface DisplayConfig {
  name?: string;
  icon?: string;
  color?: string;
  textIcon?: string;
  website?: string;
  notice?: string;
  deprecated?: boolean;
  deprecationNotice?: string;
  kindNotice?: string;
  mediaPriority?: boolean;
}

/** Authentication sub-config within TransportConfig. */
export interface AuthConfig {
  header?: string;
  scheme?: string;
  source?: string[];
}

/**
 * Retry sub-config within TransportConfig (mirrors DEFAULT_RETRY_CONFIG shape).
 * Status-code keys (e.g. "502", "503") map to retry-entry objects or legacy attempt
 * counts — all JSON-serialisable values. Source: open-sse/config/runtimeConfig.js
 * DEFAULT_RETRY_CONFIG (lines 90-105).
 */
export interface RetryConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Status-code overrides: numeric string keys → retry entry or attempt count (JsonValue). */
  [key: string]: JsonValue;
}

/**
 * The `X-Goog-Api-Client` header string injected by the Gemini CLI transport.
 * Named alias so the intent is searchable and JSDoc can reference the source.
 * Source: open-sse/providers/registry/gemini-cli.js line 25,
 *         open-sse/config/appConstants.js line 6.
 */
export type ApiClientHeader = string;

/**
 * Config object for fetching a provider's suggested model list.
 * Consumed by src/shared/utils/providerModelsFetcher.js `fetchSuggestedModels`.
 * @see src/shared/utils/providerModelsFetcher.js lines 10-13
 */
export interface ModelsFetcherConfig {
  /** Backend-proxied endpoint URL. */
  url: string;
  /** Provider type discriminator forwarded as `?type=` query param (e.g. "openai"). */
  type: string;
}

/**
 * Runtime HTTP transport configuration (schema.js lines 27-30, PROVIDER_DEFAULTS lines 44-56).
 * `format` is the `Format` branded union type (from ./formats.js).
 */
export interface TransportConfig {
  baseUrl?: string;
  /** Format string — replace with `Format` once W1-A (open-sse/types/formats.ts) is merged. */
  format?: Format;
  headers?: Record<string, string>;
  auth?: AuthConfig;
  forceStream?: boolean;
  urlSuffix?: string;
  quirks?: Record<string, JsonValue>;
  passthroughModels?: boolean;
  retry?: RetryConfig;
  timeoutMs?: number;
  executor?: string;
  // OAuth-injected fields (from `oauth` block; listed here for shape completeness)
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  // Extended fields from schema.js line 27 comment
  usage?: boolean;
  cliVersion?: string;
  /**
   * `X-Goog-Api-Client` header value — see {@link ApiClientHeader}.
   * Source: open-sse/providers/registry/gemini-cli.js line 25.
   */
  apiClient?: ApiClientHeader;
  regions?: string[];
  defaultRegion?: string;
  /**
   * Remote models-list endpoint config consumed by providerModelsFetcher.js.
   * Shape: `{ url: string; type: string }` — see src/shared/utils/providerModelsFetcher.js
   * @param fetcher.url  Backend-proxied endpoint URL
   * @param fetcher.type Provider type discriminator (e.g. "openai")
   */
  modelsFetcher?: ModelsFetcherConfig;
  validateUrl?: string;
  responsesUrl?: string;
}

/** OAuth flow configuration (schema.js lines 32-34). */
export interface OAuthConfig {
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  deviceCodeUrl?: string;
  refreshUrl?: string;
  scope?: string;
  scopes?: string[];
  redirectUri?: string;
  callbackPath?: string;
  fixedPort?: number;
  codeChallengeMethod?: string;
  extraParams?: Record<string, string>;
  refresh?: { encoding?: string; scope?: string };
  refreshLeadMs?: number;
  userInfoUrl?: string;
}

/** Per-service sub-config within MediaConfig (schema.js lines 36-38). */
export interface MediaServiceConfig {
  baseUrl?: string;
  authType?: string;
  authHeader?: string;
  /** Format (branded union from ./formats.js). */
  format?: Format;
  defaultModel?: string;
  models?: Array<{ id: string; name: string; dimensions?: number }>;
}

/** Non-LLM media services configuration (schema.js lines 36-38). */
export interface MediaConfig {
  serviceKinds?: string[];
  ttsConfig?: MediaServiceConfig;
  sttConfig?: MediaServiceConfig;
  embeddingConfig?: MediaServiceConfig;
  imageConfig?: MediaServiceConfig;
  searchViaChat?: { defaultModel?: string; pricingUrl?: string };
  hiddenKinds?: string[];
}

/**
 * Single model entry within RegistryEntry.models (schema.js line 22).
 * Extra keys carry open metadata (contextLength, supportsVision, capabilities,
 * dimensions, maxOutputTokens, kind, params, etc.) from registry files — all
 * JSON-serialisable. Source: open-sse/providers/registry/*.js across all providers.
 */
export interface ModelEntry {
  id: string;
  name?: string;
  [key: string]: JsonValue;
}

// ---------------------------------------------------------------------------
// Top-level registry entry
// ---------------------------------------------------------------------------

/**
 * Full contract for a provider registry entry (open-sse/providers/schema.js lines 8-26).
 * Only `id` and `category` are strictly required; all other fields are optional.
 */
export interface RegistryEntry {
  /** Unique provider id (kebab-case). REQUIRED. */
  id: string;
  /** UI grouping category: "apikey" | "oauth" | "freeTier" | ... REQUIRED. */
  category: string;
  /** Short key for PROVIDER_MODELS (defaults to id). */
  alias?: string;
  /** Extra lookup tokens resolving to this provider. */
  aliases?: string[];
  /** Token shown in UI badges. */
  uiAlias?: string;
  /** Auth hint: "apikey" | "oauth". */
  authType?: string;
  /** Allowed auth modes when provider supports both. */
  authModes?: string[];
  /** Provider exposes an OAuth flow. */
  hasOAuth?: boolean;
  /** Provider needs no credentials (local/free). */
  noAuth?: boolean;
  display?: DisplayConfig;
  transport?: TransportConfig;
  oauth?: OAuthConfig;
  media?: MediaConfig;
  /** Model list; omit = no model key, [] = explicit empty. */
  models?: ModelEntry[];
  features?: { usage?: boolean };
  thinkingConfig?: { options: string[]; defaultMode: string };
  /** Forward client model id untouched. */
  passthroughModels?: boolean;
}
