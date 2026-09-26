import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";
import { parseGeminiRetryDelayMs, randomGeminiNoHintCooldownMs } from "../utils/geminiRetry.js";

// Gemini API-key executor. DefaultExecutor handles the request shape; this adds
// 429 parsing: RetryInfo.retryDelay / "Please retry in Xs" → resetsAtMs so the
// key is parked (modelLock___all) instead of retried with backoff. A 429 with
// no usable hint means an exhausted free key → park it 1-3h.
export class GeminiExecutor extends DefaultExecutor {
  constructor() {
    super("gemini");
    this.config = PROVIDERS["gemini"] || this.config;
  }

  parseError(response, bodyText) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    let message = base.message;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.error?.message === "string" && parsed.error.message) {
        message = parsed.error.message;
      }
    } catch {
      // keep raw bodyText as message
    }
    const delayMs = parseGeminiRetryDelayMs(bodyText) ?? randomGeminiNoHintCooldownMs();
    return { status: response.status, message, resetsAtMs: Date.now() + delayMs };
  }
}

export default GeminiExecutor;
