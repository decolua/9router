"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { Globe, X } from "lucide-react";
import { LANGUAGES, getLanguage, DEFAULT_LANG } from "@/constants/languages";
import { t } from "@/constants/docsConfig";

function extractLangFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)(?:\/(.*))?$/);
  if (!match) return { lang: DEFAULT_LANG, rest: "" };
  return { lang: match[1], rest: match[2] || "" };
}

export default function LanguageSwitcher({ currentLang }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const current = getLanguage(currentLang);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const switchTo = (code) => {
    const { rest } = extractLangFromPath(pathname);
    const target = rest ? `/${code}/${rest}` : `/${code}`;
    setOpen(false);
    router.push(target);
  };

  const modal = open && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-bold text-lg text-gray-900">{t(currentLang, "selectLanguage")}</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
        <div className="p-2 overflow-y-auto max-h-[60vh]">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchTo(lang.code)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                lang.code === currentLang
                  ? "bg-[#E68A6E]/10 text-[#E68A6E] font-medium"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <span className="text-2xl">{lang.flag}</span>
              <div className="flex-1">
                <div className="font-medium">{lang.native}</div>
                <div className="text-xs text-gray-500">{lang.name}</div>
              </div>
              {lang.code === currentLang && <span className="text-xs">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        aria-label="Switch language"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden sm:inline">{current.flag} {current.native}</span>
        <span className="sm:hidden">{current.flag}</span>
      </button>

      {mounted && open && createPortal(modal, document.body)}
    </>
  );
}
