"use client";

import { useState, useEffect, useRef } from "react";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

// Locale display names - will be translated by runtime i18n
const getLocaleName = (locale) => {
  const names = {
    "en": "English",
    "vi": "Tiếng Việt",
    "zh-CN": "简体中文"
  };
  return names[locale] || locale;
};

export default function LanguageSwitcher({ className = "" }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSetLocale = async (nextLocale) => {
    if (nextLocale === locale || isPending) return;

    setIsPending(true);
    setIsOpen(false);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      
      // Reload translations without full page reload
      await reloadTranslations();
      setLocale(nextLocale);
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Dropdown trigger - use data attribute to prevent i18n processing */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/60 transition-colors"
        title="Language"
        data-i18n-skip="true"
      >
        <span className="material-symbols-outlined text-xl">language</span>
        <span className="text-sm font-medium">{getLocaleName(locale)}</span>
        <span className="material-symbols-outlined text-base">
          {isOpen ? "expand_less" : "expand_more"}
        </span>
      </button>

      {/* Dropdown menu - use data attribute to prevent i18n processing */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-surface border border-black/10 dark:border-white/10 rounded-lg shadow-lg overflow-hidden z-50" data-i18n-skip="true">
          {LOCALES.map((item) => {
            const active = locale === item;
            return (
              <button
                key={item}
                onClick={() => handleSetLocale(item)}
                disabled={isPending}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-text-main hover:bg-surface-hover"
                } ${isPending ? "opacity-70 cursor-wait" : ""}`}
              >
                <span>{getLocaleName(item)}</span>
                {active && (
                  <span className="material-symbols-outlined text-base">check</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
