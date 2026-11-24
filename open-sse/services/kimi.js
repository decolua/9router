import { PROVIDERS } from "../config/providers.js";
import { FORMATS } from "../translator/formats.js";
import { ROLE } from "../translator/schema/roles.js";

export const KIMI_CODE_API_KEY_PREFIX = "sk-kimi-";
export const KIMI_PLATFORM_BASE_URL = "https://api.moonshot.ai";
export const KIMI_PLATFORM_ENDPOINTS = {
  [FORMATS.OPENAI]: `${KIMI_PLATFORM_BASE_URL}/v1/chat/completions`,
  [FORMATS.CLAUDE]: `${KIMI_PLATFORM_BASE_URL}/anthropic/v1/messages`,
  [FORMATS.OPENAI_RESPONSES]: `${KIMI_PLATFORM_BASE_URL}/v1/responses`,
};
export const KIMI_PLATFORM_MODELS_URL = `${KIMI_PLATFORM_BASE_URL}/v1/models`;
export const KIMI_VALIDATION_MODEL = "kimi-latest";

export function isKimiPlatformApiKey(apiKey) {
  return typeof apiKey === "string" && apiKey.length > 0 && !apiKey.startsWith(KIMI_CODE_API_KEY_PREFIX);
}

export function createKimiApiKeyProbe(apiKey) {
  if (isKimiPlatformApiKey(apiKey)) {
    return {
      url: KIMI_PLATFORM_MODELS_URL,
      options: { method: "GET", headers: { "Authorization": `Bearer ${apiKey}` } },
    };
  }
  const body = JSON.stringify({
    model: KIMI_VALIDATION_MODEL,
    max_tokens: 1,
    messages: [{ role: ROLE.USER, content: "test" }],
  });
  return {
    url: PROVIDERS.kimi.baseUrl,
    options: { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body },
  };
}

export function isKimiApiKeyAccepted(status) {
  return status !== 401 && status !== 403;
}
