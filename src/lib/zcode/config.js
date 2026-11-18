export const ZCODE_CONFIG = {
  captchaPort: Number.parseInt(process.env.ZCODE_CAPTCHA_PORT || process.env.PORT || "20128", 10),
  captchaCacheTtlMs: Number.parseInt(process.env.CAPTCHA_CACHE_TTL || "45000", 10),
  captchaHeadlessTimeoutMs: Number.parseInt(process.env.CAPTCHA_HEADLESS_TIMEOUT_MS || "45000", 10),
  captchaInteractiveTimeoutMs: Number.parseInt(process.env.CAPTCHA_INTERACTIVE_TIMEOUT_MS || "300000", 10),
  captchaConfigCacheTtlMs: Number.parseInt(process.env.CAPTCHA_CONFIG_CACHE_TTL || "600000", 10),
  headedFallback: process.env.ZCODE_CAPTCHA_HEADED_FALLBACK !== "false",
  appVersion: process.env.ZCODE_APP_VERSION || "3.16.3",
  userAgent: process.env.ZCODE_USER_AGENT || "ZCode/3.16.3",
};
