"use client";

import { useLayoutEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const { initTheme } = useThemeStore();

  useLayoutEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}