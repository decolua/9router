"use client";

import { useState, useEffect } from "react";
import { getPreferredLocale } from "@/i18n/preference";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import LanguageSwitcher from "./LanguageSwitcher";

export default function HeaderLanguage() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    setLocale(getPreferredLocale());
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
        title="Language"
        data-i18n-skip="true"
      >
        <span className="text-lg leading-none">{LOCALE_FLAGS[locale] || "🌐"}</span>
      </button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={(next) => {
          setOpen(false);
          setLocale(next);
        }}
      />
    </>
  );
}
