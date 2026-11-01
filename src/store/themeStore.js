"use client";

import { create } from "zustand";

// Theme is locked strictly to 'glass' across the entire application.
export const THEME_IDS = ["glass"];

function normalize() {
  return "glass";
}

const useThemeStore = create((set, get) => ({
  theme: "glass",
  canChangeTheme: false,
  hydrated: true,

  /**
   * Called by ThemeProvider / shell. The persisted site-wide theme is
   * strictly glass (/api/theme).
   */
  setServerTheme: (_theme, _canChange = false) => {
    set({ theme: "glass", canChangeTheme: false, hydrated: true });
    applyTheme("glass");
  },

  /** Theme is locked strictly to glass; no switching is allowed. */
  setTheme: async () => {
    set({ theme: "glass" });
    applyTheme("glass");
    return true;
  },

  toggleTheme: () => {
    applyTheme("glass");
    return "glass";
  },
}));

// Apply theme to document. Both "dark" and "glass" classes always stay on.
export function applyTheme(_theme = "glass") {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.add("dark");
  root.classList.add("glass");
}

export default useThemeStore;
