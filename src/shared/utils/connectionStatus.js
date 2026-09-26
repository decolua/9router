export function getStatusVariant(isActive, effectiveStatus) {
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "on hold") return "warning";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
  return "default";
}

// Format a cooldown countdown for the "on hold" badge: "22s" | "5m 3s" | "2h 5m".
// Returns null when the wait is over (or was never set).
export function formatOnHoldRemaining(diffMs) {
  if (diffMs == null || diffMs <= 0) return null;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
