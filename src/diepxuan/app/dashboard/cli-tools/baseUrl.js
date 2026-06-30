export function getCurrentBrowserOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export function getCliToolBaseUrl({ baseUrl = "", fallback = "" } = {}) {
  return baseUrl || getCurrentBrowserOrigin() || fallback;
}

export function getToolDetailBaseUrl({ tunnelEnabled, tunnelPublicUrl, cloudEnabled, cloudUrl } = {}) {
  const currentOrigin = getCurrentBrowserOrigin();
  if (currentOrigin) return currentOrigin;
  if (tunnelEnabled && tunnelPublicUrl) return tunnelPublicUrl;
  if (cloudEnabled && cloudUrl) return cloudUrl;
  return "";
}

