/**
 * Zed Hosted AI constants — model→upstream-provider routing and client defaults.
 * Used by ZedExecutor (open-sse/executors/zed.js).
 *
 * Zed's /completions envelope expects PascalCase provider tags matching the
 * native client (Anthropic / OpenAi / Google / XAi).
 */

/** Default x-zed-version header value when registry omits appVersion. */
export const ZED_CLIENT_VERSION = "0.200.0";

/** LLM bearer token lifetime used by the in-process cache (ms). */
export const ZED_LLM_TOKEN_TTL_MS = 50 * 60 * 1000;

/** Wire-protocol provider tags Zed accepts in CompletionBody.provider. */
export const ZED_PROVIDER = {
  anthropic: "Anthropic",
  openai: "OpenAi",
  google: "Google",
  xai: "XAi",
};

export const ZED_DEFAULT_PROVIDER = ZED_PROVIDER.openai;

/**
 * Resolve which nested Zed upstream provider a catalog value or model id should use.
 * @param {string|null|undefined} catalogProvider - raw `provider` from Zed's /models
 * @param {string|null|undefined} model
 * @returns {string} one of ZED_PROVIDER.*
 */
export function resolveZedProvider(catalogProvider, model) {
  const raw = String(catalogProvider || "").toLowerCase();
  if (raw === "anthropic") return ZED_PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return ZED_PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return ZED_PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return ZED_PROVIDER.xai;

  const m = String(model || "").toLowerCase();
  if (/(claude|anthropic)/i.test(m)) return ZED_PROVIDER.anthropic;
  if (/(gemini|google)/i.test(m)) return ZED_PROVIDER.google;
  if (/(grok|x[_-]?ai)/i.test(m)) return ZED_PROVIDER.xai;
  return ZED_DEFAULT_PROVIDER;
}
