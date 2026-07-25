"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations } from "./runtime";

export function RuntimeI18nProvider({ children }) {
  const pathname = usePathname();
  const hydrated = useRef(false);

  useEffect(() => {
    // Delay i18n DOM processing until AFTER React hydration is fully complete
    // Using requestAnimationFrame to ensure React has finished adopting the DOM
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initRuntimeI18n();
        hydrated.current = true;
      });
    });
  }, []);

  // Re-process DOM when route changes
  useEffect(() => {
    if (pathname && hydrated.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          reloadTranslations();
        });
      });
    }
  }, [pathname]);

  return <>{children}</>;
}
