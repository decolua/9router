export const LOCALES = ["en", "vi", "zh-CN"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  "en": "English",
  "vi": "Tiếng Việt",
  "zh-CN": "简体中文"
};

export function normalizeLocale(locale) {
  if (locale === "zh" || locale === "zh-CN") {
    return "zh-CN";
  }
  if (locale === "en") {
    return "en";
  }
  if (locale === "vi") {
    return "vi";
  }
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
