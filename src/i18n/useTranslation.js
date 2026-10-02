"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE } from "./config";
import { getCurrentLocale, onLocaleChange, translate } from "./runtime";

const serverLocale = () => DEFAULT_LOCALE;

// Interpolate after lookup so translations can reorder values and rich content.
// React renders the returned nodes; translations never become HTML.
export function formatMessage(message, values = {}) {
  const parts = message.split(/(\{\w+\})/g).map(part => {
    const key = part.slice(1, -1);
    return /^\{\w+\}$/.test(part) && Object.hasOwn(values, key) ? values[key] : part;
  });
  return parts.every(part => typeof part === "string" || typeof part === "number")
    ? parts.join("") : parts;
}

export function useTranslation() {
  const locale = useSyncExternalStore(onLocaleChange, getCurrentLocale, serverLocale);
  return useCallback((message, values) => formatMessage(
    locale === DEFAULT_LOCALE ? message : translate(message), values,
  ), [locale]);
}
