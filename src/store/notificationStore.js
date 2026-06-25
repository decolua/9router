/**
 * Notification Store — Zustand-based global toast notification system.
 * Centralized feedback for dashboard actions.
 */

import { create } from "zustand";

let idCounter = 0;
const timeouts = new Map();

export const useNotificationStore = create((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = ++idCounter;
    const entry = {
      id,
      type: notification.type || "info",
      message: notification.message,
      title: notification.title || null,
      duration: notification.duration ?? 5000,
      dismissible: notification.dismissible ?? true,
      createdAt: Date.now(),
    };

    set((s) => {
      let next = [...s.notifications, entry];
      if (next.length > 50) {
        const evicted = next.slice(0, next.length - 50);
        next = next.slice(-50);
        for (const ev of evicted) {
          if (timeouts.has(ev.id)) {
            clearTimeout(timeouts.get(ev.id));
            timeouts.delete(ev.id);
          }
        }
      }
      return { notifications: next };
    });

    // Auto-dismiss
    if (entry.duration > 0) {
      const handle = setTimeout(() => get().removeNotification(id), entry.duration);
      timeouts.set(id, handle);
    }

    return id;
  },

  removeNotification: (id) => {
    if (timeouts.has(id)) {
      clearTimeout(timeouts.get(id));
      timeouts.delete(id);
    }
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  clearAll: () => {
    for (const handle of timeouts.values()) {
      clearTimeout(handle);
    }
    timeouts.clear();
    set({ notifications: [] });
  },

  success: (message, title) => get().addNotification({ type: "success", message, title }),
  error: (message, title) => get().addNotification({ type: "error", message, title, duration: 8000 }),
  warning: (message, title) => get().addNotification({ type: "warning", message, title }),
  info: (message, title) => get().addNotification({ type: "info", message, title }),
}));
