"use client";

import { cn } from "@/shared/utils/cn";

const STYLES = {
  configured: "bg-success/10 text-success",
  connected: "bg-success/10 text-success",
  not_configured: "bg-warning/10 text-warning",
  other: "bg-info/10 text-info",
  not_installed: "bg-surface-3 text-text-muted",
  unknown: "bg-surface-3 text-text-muted",
};

const LABELS = {
  configured: "Connected",
  connected: "Connected",
  not_configured: "Not configured",
  other: "Other",
  not_installed: "Not installed",
  unknown: "Unknown",
};

/** CLI tool connection status pill (header badges + summary cards). */
export default function ConfigStatusBadge({ status, className }) {
  if (!status) return null;
  const key = status in STYLES ? status : "unknown";
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 text-[10px] font-medium rounded-full",
        STYLES[key],
        className
      )}
    >
      {LABELS[key]}
    </span>
  );
}

export function getToolInstallStatus(status) {
  if (!status) return { status: "unknown" };
  if (!status.installed) return { status: "not_installed" };
  if (status.has9Router) return { status: "connected" };
  return { status: "not_configured" };
}

/** True when the tool is installed and points at 9router (badge: "Connected"). */
export function isCliToolConfigured(status) {
  return getToolInstallStatus(status).status === "connected";
}
