"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const usePrivacyStore = create(
  persist(
    (set, get) => ({
      blurEmails: false,

      setBlurEmails: (blurEmails) => set({ blurEmails }),

      toggleBlurEmails: () => set({ blurEmails: !get().blurEmails }),
    }),
    {
      name: "privacy-storage",
    }
  )
);

export default usePrivacyStore;
