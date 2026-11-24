"use client";

import { createContext, createElement, useContext, useEffect, useRef, useState } from "react";

const DashboardStatus = createContext(null);

export function loadDashboardStatus(pending) {
  return pending.current ??= fetch("/api/auth/status", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
}

export function effectiveRole(serverRole, status) {
  const roles = ["admin", "viewer"];
  if (!roles.includes(serverRole) || !roles.includes(status?.role)) return null;
  return serverRole === "admin" && status.role === "admin" ? "admin" : "viewer";
}

export function DashboardRoleProvider({ serverRole, children }) {
  const [status, setStatus] = useState(null);
  const pending = useRef(null);
  useEffect(() => {
    let active = true;
    // Layout owns this request across navigation and Strict Mode effect replay.
    loadDashboardStatus(pending).then(data => { if (active) setStatus(data ?? {}); });
    return () => { active = false; };
  }, []);
  const role = effectiveRole(serverRole, status);
  return createElement(DashboardStatus.Provider, { value: { ...status, role, loading: status === null } }, children);
}

export function useDashboardRole() {
  return useContext(DashboardStatus);
}
