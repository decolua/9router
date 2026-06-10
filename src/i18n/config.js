export const LOCALES = ["en", "vi", "zh-CN", "zh-TW", "ja", "pt-BR", "pt-PT", "ko", "es", "de", "fr", "he", "ar", "ru", "pl", "cs", "nl", "tr", "uk", "tl", "id", "th", "hi", "bn", "ur", "ro", "sv", "it", "el", "hu", "fi", "da", "no"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  "en": "English",
  "vi": "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ja": "日本語",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  "ko": "한국어",
  "es": "Español",
  "de": "Deutsch",
  "fr": "Français",
  "he": "עברית",
  "ar": "العربية",
  "ru": "Русский",
  "pl": "Polski",
  "cs": "Čeština",
  "nl": "Nederlands",
  "tr": "Türkçe",
  "uk": "Українська",
  "tl": "Tagalog",
  "id": "Indonesia",
  "th": "ไทย",
  "hi": "हिन्दी",
  "bn": "বাংলা",
  "ur": "اردو",
  "ro": "Română",
  "sv": "Svenska",
  "it": "Italiano",
  "el": "Ελληνικά",
  "hu": "Magyar",
  "fi": "Suomi",
  "da": "Dansk",
  "no": "Norsk"
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
  if (locale === "zh-TW") {
    return "zh-TW";
  }
  if (locale === "ja") {
    return "ja";
  }
  if (locale === "pt-BR") {
    return "pt-BR";
  }
  if (locale === "pt-PT") {
    return "pt-PT";
  }
  if (locale === "ko") {
    return "ko";
  }
  if (locale === "es") {
    return "es";
  }
  if (locale === "de") {
    return "de";
  }
  if (locale === "fr") {
    return "fr";
  }
  if (locale === "he") {
    return "he";
  }
  if (locale === "ar") {
    return "ar";
  }
  if (locale === "ru") {
    return "ru";
  }
  if (locale === "pl") {
    return "pl";
  }
  if (locale === "cs") {
    return "cs";
  }
  if (locale === "nl") {
    return "nl";
  }
  if (locale === "tr") {
    return "tr";
  }
  if (locale === "uk") {
    return "uk";
  }
  if (locale === "tl") {
    return "tl";
  }
  if (locale === "id") {
    return "id";
  }
  if (locale === "th") {
    return "th";
  }
  if (locale === "hi") {
    return "hi";
  }
  if (locale === "bn") {
    return "bn";
  }
  if (locale === "ur") {
    return "ur";
  }
  if (locale === "ro") {
    return "ro";
  }
  if (locale === "sv") {
    return "sv";
  }
  if (locale === "it") {
    return "it";
  }
  if (locale === "el") {
    return "el";
  }
  if (locale === "hu") {
    return "hu";
  }
  if (locale === "fi") {
    return "fi";
  }
  if (locale === "da") {
    return "da";
  }
  if (locale === "no") {
    return "no";
  }
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
