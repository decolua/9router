"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

// Locale display names and flags - will be translated by runtime i18n
const getLocaleInfo = (locale) => {
  const locales = {
    "en": { name: "English", flag: "🇺🇸" },
    "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
    "zh-CN": { name: "简体中文", flag: "🇨🇳" },
    "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
    "ja": { name: "日本語", flag: "🇯🇵" },
    "pt-BR": { name: "Português (Brasil)", flag: "🇧🇷" },
    "pt-PT": { name: "Português (Portugal)", flag: "🇵🇹" },
    "ko": { name: "한국어", flag: "🇰🇷" },
    "es": { name: "Español", flag: "🇪🇸" },
    "de": { name: "Deutsch", flag: "🇩🇪" },
    "fr": { name: "Français", flag: "🇫🇷" },
    "he": { name: "עברית", flag: "🇮🇱" },
    "ar": { name: "العربية", flag: "🇸🇦" },
    "ru": { name: "Русский", flag: "🇷🇺" },
    "pl": { name: "Polski", flag: "🇵🇱" },
    "cs": { name: "Čeština", flag: "🇨🇿" },
    "nl": { name: "Nederlands", flag: "🇳🇱" },
    "tr": { name: "Türkçe", flag: "🇹🇷" },
    "uk": { name: "Українська", flag: "🇺🇦" },
    "tl": { name: "Tagalog", flag: "🇵🇭" },
    "id": { name: "Indonesia", flag: "🇮🇩" },
    "th": { name: "ไทย", flag: "🇹🇭" },
    "hi": { name: "हिन्दी", flag: "🇮🇳" },
    "bn": { name: "বাংলা", flag: "🇧🇩" },
    "ur": { name: "اردو", flag: "🇵🇰" },
    "ro": { name: "Română", flag: "🇷🇴" },
    "sv": { name: "Svenska", flag: "🇸🇪" },
    "it": { name: "Italiano", flag: "🇮🇹" },
    "el": { name: "Ελληνικά", flag: "🇬🇷" },
    "hu": { name: "Magyar", flag: "🇭🇺" },
    "fi": { name: "Suomi", flag: "🇫🇮" },
    "da": { name: "Dansk", flag: "🇩🇰" },
    "no": { name: "Norsk", flag: "🇳🇴" }
  };
  return locales[locale] || { name: locale, flag: "🌐" };
};

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const modalRef = useRef(null);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (value) => {
    if (isControlled) {
      if (!value && onClose) onClose();
    } else {
      setInternalOpen(value);
    }
  };

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

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
    <div className={className}>
      {/* Trigger button */}
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/60 transition-colors"
          title="Language"
          data-i18n-skip="true"
        >
          <span className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
          <span className="text-lg">{getLocaleInfo(locale).flag}</span>
        </button>
      )}

      {/* Portal modal - renders at document.body to avoid parent layout constraints */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-i18n-skip="true">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal content */}
          <div
            ref={modalRef}
            className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-2xl flex flex-col max-h-[80vh]"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
              <h2 className="text-lg font-semibold text-text-main">Select Language</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal body - fixed grid columns, equal sizing */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
                {LOCALES.map((item) => {
                  const active = locale === item;
                  const info = getLocaleInfo(item);
                  return (
                    <button
                      key={item}
                      onClick={() => handleSetLocale(item)}
                      disabled={isPending}
                      className={`flex flex-col items-center justify-start gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-colors w-full ${
                        active
                          ? "bg-primary/15 text-primary ring-2 ring-primary"
                          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                      } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                      title={info.name}
                    >
                      <span className="text-2xl">{info.flag}</span>
                      {/* Fixed 2-line height so all cards are uniform */}
                      <span className="text-center leading-tight line-clamp-2 h-8 flex items-center">{info.name}</span>
                      {active && (
                        <span className="material-symbols-outlined text-sm">check</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
