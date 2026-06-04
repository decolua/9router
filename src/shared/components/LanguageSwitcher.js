"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

function getLocaleInfo(locale) {
  const info = {
    en: { name: LOCALE_NAMES.en, mark: "EN" },
    "zh-CN": { name: LOCALE_NAMES["zh-CN"], mark: "中" },
  };
  return info[locale] || { name: locale, mark: locale.toUpperCase() };
}

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const modalRef = useRef(null);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (value) => {
    if (isControlled) {
      if (!value && onClose) onClose(locale);
    } else {
      setInternalOpen(value);
    }
  };

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

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
      await reloadTranslations();
      setLocale(nextLocale);
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  const current = getLocaleInfo(locale);
  const titleText = locale === "zh-CN" ? "选择语言" : "Select Language";

  return (
    <div className={className}>
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-text-muted transition-colors hover:bg-surface/60 hover:text-text-main"
          title="Language"
          data-i18n-skip="true"
        >
          <span className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{current.name}</span>
          <span className="rounded border border-border px-1.5 py-0.5 text-xs font-semibold">{current.mark}</span>
        </button>
      )}

      {isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-i18n-skip="true">
          <button
            type="button"
            aria-label="Close language selector"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          <div
            ref={modalRef}
            className="relative flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-black/10 bg-surface shadow-2xl dark:border-white/10"
          >
            <div className="flex items-center justify-between border-b border-black/5 p-3 dark:border-white/5">
              <h2 className="text-lg font-semibold text-text-main">{titleText}</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-6">
              {LOCALES.map((item) => {
                const active = locale === item;
                const info = getLocaleInfo(item);
                return (
                  <button
                    key={item}
                    onClick={() => handleSetLocale(item)}
                    disabled={isPending}
                    className={`flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary/15 text-primary ring-2 ring-primary"
                        : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                    } ${isPending ? "cursor-wait opacity-70" : ""}`}
                    title={info.name}
                  >
                    <span className="rounded border border-border px-2 py-1 text-xs font-semibold">{info.mark}</span>
                    <span className="text-center leading-tight">{info.name}</span>
                    {active && <span className="material-symbols-outlined text-sm">check</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
