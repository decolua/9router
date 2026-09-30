"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: "dark",

      setTheme: (theme) => {
        set({ theme: "dark" });
        applyTheme("dark");
      },

      toggleTheme: () => {
        set({ theme: "dark" });
        applyTheme("dark");
      },

      initTheme: () => {
        set({ theme: "dark" });
        applyTheme("dark");
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Apply theme to document
function applyTheme(theme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  root.classList.add("dark");
}

export default useThemeStore;

