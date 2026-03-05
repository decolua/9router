import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import enMap from "./en.json";
import zhCNMap from "./zh-CN.json";

const MAPS = {
  en: enMap,
  "zh-CN": zhCNMap,
};

function readLocaleFromCookie() {
  if (typeof document === "undefined") {
    return DEFAULT_LOCALE;
  }
  const raw = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${LOCALE_COOKIE}=`));
  const value = raw ? decodeURIComponent(raw.split("=")[1] || "") : "";
  return normalizeLocale(value || DEFAULT_LOCALE);
}

function interpolate(template, values) {
  if (!values || typeof values !== "object") {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

export function i18nText(source, values) {
  if (typeof source !== "string" || source.length === 0) {
    return source;
  }

  const locale = readLocaleFromCookie();
  if (locale === "en") {
    return interpolate(source, values);
  }

  const map = MAPS[locale] || {};
  const target = map[source] || source;
  return interpolate(target, values);
}
