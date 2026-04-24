export const LOCALES = ["en", "vi"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES: Record<string, string> = {
  "en": "English",
  "vi": "Tiếng Việt"
};

export function normalizeLocale(locale: string | null | undefined): string {
  if (locale === "vi") {
    return "vi";
  }
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale: string): boolean {
  return LOCALES.includes(locale);
}
