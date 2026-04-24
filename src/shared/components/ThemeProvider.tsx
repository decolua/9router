"use client";

import React, { useEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}
