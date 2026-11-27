import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale, normalizeLocale } from "./config.js";

const LOCALE_STORAGE_KEY = "9router.locale";

export function getPreferredLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Storage can be blocked by browser settings.
  }

  const prefix = `${LOCALE_COOKIE}=`;
  const cookie = document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  try {
    return cookie ? normalizeLocale(decodeURIComponent(cookie.slice(prefix.length))) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function savePreferredLocale(locale) {
  const response = await fetch("/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw new Error(`Locale update failed (${response.status})`);

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The language cookie still works when localStorage is unavailable.
  }
}
