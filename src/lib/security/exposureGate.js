/**
 * Guards remote dashboard/tunnel exposure until basic auth hardening is in place.
 */

export function hasCustomPassword(settings) {
  return Boolean(settings?.password);
}

export function getRemoteExposureBlockReason(settings) {
  if (!settings) return "Settings unavailable.";
  if (!hasCustomPassword(settings)) {
    return "Set a custom password in Profile before enabling remote access.";
  }
  if (settings.requireLogin === false) {
    return "Enable dashboard login in Profile before enabling remote access.";
  }
  return null;
}

export function isRemoteExposureRequest(updates = {}) {
  return (
    updates.tunnelDashboardAccess === true ||
    updates.tunnelEnabled === true ||
    updates.tailscaleEnabled === true
  );
}
