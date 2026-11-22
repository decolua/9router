"use client";

import { useEffect } from "react";
import useThemeStore, { applyTheme } from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const setServerTheme = useThemeStore((state) => state.setServerTheme);

  useEffect(() => {
    // Reassert the single site-wide neobrutalist system after hydration.
    applyTheme("neobrutalism");
    setServerTheme("neobrutalism", false);
  }, [setServerTheme]);

  return <>{children}</>;
}
