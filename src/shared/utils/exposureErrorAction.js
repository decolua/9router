/**
 * Map exposure-gate API errors to dashboard actions.
 */
export function getExposureErrorAction(message) {
  if (!message || typeof message !== "string") return null;
  const lower = message.toLowerCase();
  if (lower.includes("custom password") || lower.includes("profile")) {
    return { label: "Open Profile", href: "/dashboard/profile" };
  }
  if (lower.includes("dashboard login") || lower.includes("require login")) {
    return { label: "Security settings", href: "/dashboard/profile" };
  }
  return null;
}
