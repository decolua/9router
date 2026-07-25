/**
 * Zed Hosted AI constants — model→upstream-provider routing and client defaults.
 * Used by the openai→zed translator and ZedExecutor.
 */

/** Default x-zed-version header value. */
export const ZED_CLIENT_VERSION = "1.6.3";

/** LLM bearer token lifetime when upstream omits expires_in (seconds). */
export const ZED_LLM_TOKEN_EXPIRES_IN = 3600;

/**
 * Ordered model-id patterns that map a Zed catalog model onto the nested
 * upstream provider Zed expects in CompletionBody.provider.
 * First match wins; unmatched models fall back to ZED_DEFAULT_PROVIDER.
 */
export const ZED_PROVIDER_PATTERNS = [
  { provider: "anthropic", pattern: /(claude|anthropic)/i },
  { provider: "google", pattern: /(gemini|google)/i },
  { provider: "x_ai", pattern: /(grok|x[_-]?ai)/i },
];

export const ZED_DEFAULT_PROVIDER = "open_ai";

/**
 * Resolve which nested Zed upstream provider a model id should use.
 * @param {string} model
 * @returns {string}
 */
export function resolveZedProvider(model) {
  const m = String(model || "").toLowerCase();
  for (const { provider, pattern } of ZED_PROVIDER_PATTERNS) {
    if (pattern.test(m)) return provider;
  }
  return ZED_DEFAULT_PROVIDER;
}
