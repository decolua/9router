"use client";

import { useEffect } from "react";
import useThemeStore, { applyTheme } from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const setServerTheme = useThemeStore((state) => state.setServerTheme);

  useEffect(() => {
    // Lock theme strictly to glass everywhere
    applyTheme("glass");
    setServerTheme("glass", false);
  }, [setServerTheme]);

  return <>{children}</>;
}
