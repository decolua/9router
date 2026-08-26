export const LOCALES = ["en", "es", "pt-BR"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  en: "English",
  es: "Español",
  "pt-BR": "Português (Brasil)",
};

export function normalizeLocale(locale) {
  const value = String(locale || "").trim();
  if (LOCALES.includes(value)) return value;

  const language = value.toLowerCase().split(/[-_]/)[0];
  if (language === "pt") return "pt-BR";
  if (language === "es") return "es";
  if (language === "en") return "en";
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
