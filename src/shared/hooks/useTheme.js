"use client";

import useThemeStore, { applyTheme } from "@/store/themeStore";

export function useTheme() {
  const { theme, setTheme, toggleTheme } = useThemeStore();

  return {
    theme: "glass",
    setTheme,
    toggleTheme,
    isDark: true,
    isGlass: true,
    applyTheme,
  };
}
