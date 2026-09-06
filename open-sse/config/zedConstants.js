/**
 * Zed Hosted AI constants — model→upstream-provider routing and client defaults.
 * Used by ZedExecutor (open-sse/executors/zed.js) and zedAuth (open-sse/shared/zedAuth.js).
 *
 * Zed's /completions envelope expects snake_case provider tags on the HTTP API
 * (anthropic / open_ai / google / x_ai). PascalCase values are accepted by the
 * JSON parser but fail at runtime with opaque 500s.
 */

export const ZED_WEB_BASE_URL = "https://zed.dev";
export const ZED_CLOUD_BASE_URL = "https://cloud.zed.dev";
export const ZED_LLM_BASE_URL = "https://cloud.zed.dev";

/** Default x-zed-version header value when registry omits appVersion. */
export const ZED_CLIENT_VERSION = "1.6.3";

/** Header names shared by cloud.zed.dev LLM + account APIs. */
export const ZED_HEADER_NAMES = {
  version: "x-zed-version",
  expiredToken: "x-zed-expired-token",
  outdatedToken: "x-zed-outdated-token",
  clientSupportsStatus: "x-zed-client-supports-status-messages",
  clientSupportsStreamEnded:
    "x-zed-client-supports-stream-ended-request-completion-status",
  serverSupportsStatus: "x-zed-server-supports-status-messages",
  clientSupportsXai: "x-zed-client-supports-x-ai",
  systemId: "x-zed-system-id",
};

/** Alias for existing imports (zedAuth / executor). */
export const ZED_HEADERS = ZED_HEADER_NAMES;

/** LLM bearer token lifetime used by the in-process cache (ms). */
export const ZED_LLM_TOKEN_TTL_MS = 50 * 60 * 1000;

/** Live /models catalog cache TTL (ms). */
export const ZED_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

/** Opaque verifier prefix for RSA private keys flowing through OAuth codeVerifier. */
export const ZED_PRIVATE_KEY_PREFIX = "zed-rsa-pkcs1:";

/** Plan ids that do not include Zed-hosted model access. */
export const ZED_FREE_PLAN_IDS = new Set(["zed_free", "free"]);

/** Default local native-app callback port (Zed sign-in redirect target). */
export const ZED_DEFAULT_NATIVE_APP_PORT = 58443;

/** How long the local Zed OAuth callback proxy stays up (ms). */
export const ZED_OAUTH_TIMEOUT_MS = 600_000;

/** Account page path (joined with webBaseUrl) for upgrade / trial. */
export const ZED_ACCOUNT_PATH = "/account";

/** Wire-protocol provider tags for CompletionBody.provider (HTTP API snake_case). */
export const ZED_PROVIDER = {
  anthropic: "anthropic",
  openai: "open_ai",
  google: "google",
  xai: "x_ai",
};

export const ZED_DEFAULT_PROVIDER = ZED_PROVIDER.openai;

/** Normalize catalog / legacy provider strings to ZED_PROVIDER wire values. */
function normalizeZedProviderTag(value) {
  const raw = String(value || "").toLowerCase().replace(/-/g, "_");
  if (raw === "anthropic") return ZED_PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return ZED_PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return ZED_PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return ZED_PROVIDER.xai;
  return null;
}

/**
 * Resolve which nested Zed upstream provider a catalog value or model id should use.
 * @param {string|null|undefined} catalogProvider - raw `provider` from Zed's /models
 * @param {string|null|undefined} model
 * @returns {string} one of ZED_PROVIDER.*
 */
export function resolveZedProvider(catalogProvider, model) {
  const fromCatalog = normalizeZedProviderTag(catalogProvider);
  if (fromCatalog) return fromCatalog;

  const m = String(model || "").toLowerCase();
  if (/(claude|anthropic)/i.test(m)) return ZED_PROVIDER.anthropic;
  if (/(gemini|google)/i.test(m)) return ZED_PROVIDER.google;
  if (/(grok|x[_-]?ai)/i.test(m)) return ZED_PROVIDER.xai;
  return ZED_DEFAULT_PROVIDER;
}

/**
 * Human-readable warning when /models is empty due to plan/quota gates.
 * @param {string} webBaseUrl
 */
export function buildZedHostedModelsBlockedMessage(webBaseUrl) {
  const accountUrl = `${String(webBaseUrl || ZED_WEB_BASE_URL).replace(/\/+$/, "")}${ZED_ACCOUNT_PATH}`;
  return (
    "Zed Hosted AI models require Zed Pro (or an active Pro trial). " +
    "This account is on the free plan with no hosted-model quota, so the live catalog is empty. " +
    `Start a trial or upgrade at ${accountUrl} — then refresh this page.`
  );
}

export function buildZedEmptyCatalogMessage() {
  return "Zed returned an empty model catalog for this account.";
}

/**
 * Zed often returns a bare `{"message":"An internal server error occurred."}` for
 * billing/quota failures instead of a typed error code. Pair with plan info when known.
 * @param {object} [planInfo] - from summarizeZedPlan
 * @param {string} [webBaseUrl]
 */
export function buildZedOpaqueCompletionErrorMessage(planInfo, webBaseUrl) {
  const accountUrl = `${String(webBaseUrl || ZED_WEB_BASE_URL).replace(/\/+$/, "")}${ZED_ACCOUNT_PATH}`;
  const planId = planInfo?.planId || "unknown";
  const limit = planInfo?.modelRequestLimit;
  const bits = [`Upstream plan reported by cloud.zed.dev: ${planId}.`];
  if (limit === 0) {
    bits.push("Hosted model_requests limit is 0 (token-based plans sometimes still show this).");
  }
  bits.push(
    `If you upgraded to Pro, confirm the same GitHub user is connected in 9router and refresh credentials at ${accountUrl}. ` +
      "Otherwise contact billing-support@zed.dev with your GitHub username.",
  );
  return (
    "Zed /completions returned an opaque 500 (request JSON accepted; failure is upstream). " +
    bits.join(" ")
  );
}
