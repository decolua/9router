"use client";

import { useEffect, useState } from "react";

const DEFAULT_STATE = {
  loading: true,
  requireLogin: true,
  hasPassword: true,
  requireApiKey: false,
  tunnelDashboardAccess: false,
  tunnelEnabled: false,
  tailscaleEnabled: false,
};

/** Security-related settings shared across dashboard pages. */
export function useDashboardSecurity() {
  const [security, setSecurity] = useState(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("settings fetch failed");
        const data = await res.json();
        if (cancelled) return;
        setSecurity({
          loading: false,
          requireLogin: data.requireLogin !== false,
          hasPassword: !!data.hasPassword,
          requireApiKey: !!data.requireApiKey,
          tunnelDashboardAccess: data.tunnelDashboardAccess === true,
          tunnelEnabled: data.tunnelEnabled === true,
          tailscaleEnabled: data.tailscaleEnabled === true,
        });
      } catch {
        if (!cancelled) setSecurity((prev) => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const remoteExposureActive = security.tunnelEnabled || security.tailscaleEnabled;
  const isLoginUnsafe = !security.requireLogin || !security.hasPassword;

  return {
    ...security,
    remoteExposureActive,
    isLoginUnsafe,
  };
}
