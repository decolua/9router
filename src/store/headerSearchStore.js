/**
 * Header Search Store — Zustand-based reusable search input in Header.
 * Pages register placeholder on mount, read query, unregister on unmount.
 */

import { create } from "zustand";

export const useHeaderSearchStore = create((set) => ({
  query: "",
  placeholder: "",
  visible: false,

  setQuery: (query) => set({ query }),

  register: (placeholder = "Search...") =>
    set({ visible: true, placeholder, query: "" }),

  unregister: () => set({ visible: false, placeholder: "", query: "" }),
}));
