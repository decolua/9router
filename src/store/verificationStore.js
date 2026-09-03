"use client";

import { create } from "zustand";

export function isValidVerificationUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "accounts.google.com"
    );
  } catch {
    return false;
  }
}

function sanitizeRecord(rec) {
  if (!rec || typeof rec.url !== "string" || !isValidVerificationUrl(rec.url)) {
    return null;
  }
  return rec;
}

export const useVerificationStore = create((set, get) => ({
  latestVerification: null,
  verifications: {},

  setFromPayload: (data) => {
    if (!data || typeof data !== "object") return;

    let latest = null;
    if ("antigravityVerification" in data) {
      latest = sanitizeRecord(data.antigravityVerification);
    }

    const map = {};
    if (data.antigravityVerifications && typeof data.antigravityVerifications === "object") {
      for (const [key, val] of Object.entries(data.antigravityVerifications)) {
        const sanitized = sanitizeRecord(val);
        if (sanitized) {
          map[key] = sanitized;
        }
      }
    } else if (latest) {
      const k = latest.connectionId || "default";
      map[k] = latest;
    }

    set({
      latestVerification: latest,
      verifications: map,
    });
  },

  getForConnection: (connectionId) => {
    const { verifications, latestVerification } = get();
    if (connectionId && verifications[connectionId]) {
      return verifications[connectionId];
    }
    if (latestVerification && latestVerification.connectionId === connectionId) {
      return latestVerification;
    }
    return null;
  },

  clearAll: () => set({ latestVerification: null, verifications: {} }),
}));
