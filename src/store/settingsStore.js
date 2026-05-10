"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";

const useSettingsStore = create((set, get) => ({
  settings: null,
  loading: false,
  error: null,
  lastFetched: 0,

  invalidate: () => set({ lastFetched: 0 }),

  // Skips network when cache is fresh; pass {force:true} to override
  fetchSettings: async ({ force = false } = {}) => {
    const { lastFetched, settings } = get();
    if (!force && settings && Date.now() - lastFetched < CLIENT_STORE_TTL_MS) return settings;
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (res.ok) {
        set({ settings: data, loading: false, lastFetched: Date.now() });
        return data;
      }
      set({ error: data.error, loading: false });
    } catch (e) {
      set({ error: "Failed to fetch settings", loading: false });
    }
    return null;
  },

  // PATCH server + merge into local cache (no extra fetch needed)
  patchSettings: async (patch) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const updated = await res.json();
      set({ settings: updated, lastFetched: Date.now() });
      return updated;
    } catch {
      return null;
    }
  },
}));

export default useSettingsStore;
