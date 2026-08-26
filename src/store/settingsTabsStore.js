import { create } from "zustand";

export const SETTINGS_TABS = [
  ["general", "常规"],
  ["security", "安全与登录"],
  ["routing", "路由与恢复"],
  ["navigation", "导航栏"],
  ["usage", "流量"],
  ["network", "网络"],
  ["observability", "可观测性"],
];

export const useSettingsTabsStore = create((set) => ({
  activeTab: "general",
  setActiveTab: (activeTab) => set({ activeTab }),
}));
