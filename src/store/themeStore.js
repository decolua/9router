"use client";

import { create } from "zustand";

const THEME_ID = "neobrutalism";
export const THEME_IDS = [THEME_ID];

function normalize() {
  return THEME_ID;
}

const useThemeStore = create((set) => ({
  theme: THEME_ID,
  canChangeTheme: false,
  hydrated: true,

  /** Called by ThemeProvider / shell; the site-wide theme is locked. */
  setServerTheme: (_theme, _canChange = false) => {
    set({ theme: THEME_ID, canChangeTheme: false, hydrated: true });
    applyTheme(THEME_ID);
  },

  /** Neobrutalism is the single locked site-wide visual system. */
  setTheme: async () => {
    set({ theme: THEME_ID });
    applyTheme(THEME_ID);
    return true;
  },

  toggleTheme: () => {
    applyTheme(THEME_ID);
    return THEME_ID;
  },
}));

export function applyTheme(_theme = THEME_ID) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "glass", "brutalist");
  root.classList.add(THEME_ID);
}

export default useThemeStore;
