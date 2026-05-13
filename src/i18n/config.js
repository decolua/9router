export const LOCALES = ["en", "id"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  "en": "English",
  "id": "Indonesia"
};

export function normalizeLocale(locale) {
  if (locale === "id" || locale === "id") {
    return "id";
  }
  if (locale === "en") {
    return "en";
  }
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
