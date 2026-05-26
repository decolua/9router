"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations } from "./runtime";

export function RuntimeI18nProvider({ children }) {
  const pathname = usePathname();

  useEffect(() => {
    initRuntimeI18n().then(() => {
      document.documentElement.classList.remove("i18n-loading");
    });
  }, []);

  // Re-process DOM when route changes
  useEffect(() => {
    if (pathname) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          reloadTranslations();
        });
      });
    }
  }, [pathname]);

  return <>{children}</>;
}