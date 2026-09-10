import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * OpenRouterExecutor — specialized for the OpenRouter gateway.
 *
 * Why this exists (see PR for full root-cause analysis):
 *
 * OpenRouter auto-routes every `model` lookup to one of its internal upstream
 * providers. For some models — e.g. `openrouter/fusion` — its primary upstream is
 * branded "Stealth", and OpenRouter's Stealth provider is configured (upstream
 * of 9router) with an empty `url` field. When 9router forwards a request for
 * such a model OpenRouter responds with HTTP 502:
 *
 *   {
 *     "error": {
 *       "message": "Invalid URL: ",
 *       "code": 502,
 *       "metadata": { "provider_name": "Stealth" }
 *     },
 *     "user_id": "user_..."
 *   }
 *
 * Plain retries against the same body never clear this — Stealth stays broken.
 * The minimal, side-effect-free mitigation 9router can apply is to set
 * `provider: { allow_fallbacks: true }` on every outbound request, which lets
 * OpenRouter route to an alternate upstream if the primary's route is broken.
 *
 * The executor is registered in `executors/index.js` so `getExecutor("openrouter")`
 * returns this instance instead of the generic `DefaultExecutor` fallback.
 */
export class OpenRouterExecutor extends DefaultExecutor {
  constructor() {
    super("openrouter", PROVIDERS.openrouter);
  }

  /**
   * Request OpenRouter's provider-fallback routing on chat calls.
   * `allow_fallbacks: true` is a no-op when the only configured provider is
   * healthy, but recovers the request whenever the model's primary upstream
   * (e.g. OpenRouter's "Stealth") is misconfigured upstream of 9router.
   *
   * Translation layer already normalises the body shape; we only mutate the
   * root key `provider`, which is OpenRouter's documented routing object.
   *
   * Three input shapes, ordered by how cautiously we mutate:
   *  - missing   → inject `{ allow_fallbacks: true }` (default opt-in).
   *  - object    → shallow-merge `allow_fallbacks: true` only when the caller
   *                hasn't already set it (preserve user intent).
   *  - non-object (string name `provider: "Azure"`, array) → leave untouched;
   *                the caller has explicitly pinned a provider / opt-out set.
   */
  transformRequest(model, body) {
    const transformed = super.transformRequest(model, body);
    if (!transformed || typeof transformed !== "object") return transformed;

    const existing = transformed.provider;
    if (existing === undefined || existing === null) {
      transformed.provider = { allow_fallbacks: true };
    } else if (typeof existing === "object" && !Array.isArray(existing)) {
      if (existing.allow_fallbacks === undefined) {
        transformed.provider = { ...existing, allow_fallbacks: true };
      }
    }
    // Non-object provider values (string, array) are intentionally preserved
    // as-is — the caller has opted into a specific routing identity.
    return transformed;
  }
}

export default OpenRouterExecutor;
