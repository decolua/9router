export default {
  apiBaseUrl: process.env.ZCODE_API_BASE_URL || "https://zcode.z.ai/api/v1",
  captchaPort: parseInt(process.env.ZCODE_CAPTCHA_PORT || process.env.PORT || "20128", 10),
  captchaCacheTTL: parseInt(process.env.CAPTCHA_CACHE_TTL || "45000", 10),
  captchaVerifyTimeoutMs: parseInt(process.env.CAPTCHA_VERIFY_TIMEOUT_MS || "120000", 10),
  captchaHeadedFallback: process.env.ZCODE_CAPTCHA_HEADED_FALLBACK !== "false",
  captchaHeadlessTimeoutMs: parseInt(process.env.CAPTCHA_HEADLESS_TIMEOUT_MS || "45000", 10),
  captchaInteractiveTimeoutMs: parseInt(process.env.CAPTCHA_INTERACTIVE_TIMEOUT_MS || "300000", 10),
  captchaConfigCacheTTL: parseInt(process.env.CAPTCHA_CONFIG_CACHE_TTL || "600000", 10),
  codingPlanUrl:
    process.env.ZAI_CODING_PLAN_URL ||
    "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
  apiKeyFallbackUrl:
    process.env.ZAI_FALLBACK_URL || "https://api.z.ai/api/anthropic/v1/messages",
  appVersion: process.env.ZCODE_APP_VERSION || "3.1.0",
  userAgent: process.env.UPSTREAM_USER_AGENT || "ZCode/3.1.0",
};