export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "none", label: "No connection" },
];

// noAuth providers (e.g. free proxies) are always usable even though they
// never have a stored connection record, so they never fall into "none".
// `requiresVendorClient` is the exception: the provider's credentialless path
// only works from the vendor's own client (opencode's free tier answers 403/401
// to this router), so without a stored connection it is NOT usable and must not
// read "active". Defaults preserve the behaviour for every other caller.
export function getConnectionStatus(stats, isNoAuth = false, requiresVendorClient = false) {
  if (isNoAuth && !requiresVendorClient) return "active";
  if (!stats || stats.total === 0) return "none";
  return stats.allDisabled ? "inactive" : "active";
}

export function matchesStatusFilter(statusFilter, stats, isNoAuth = false, requiresVendorClient = false) {
  if (statusFilter === "all") return true;
  return getConnectionStatus(stats, isNoAuth, requiresVendorClient) === statusFilter;
}

// Card label for a `requiresVendorClient` provider. Upstream answers 200 on the
// model list but 403/401 on every completion sent from this router, so the card
// must state the real requirement instead of a green "Ready" badge. The vendor
// name comes from the display name ("OpenCode Free" -> "OpenCode").
export function vendorClientOnlyLabel(name) {
  const vendor = String(name || "").replace(/\s*(free|free tier)$/i, "").trim();
  return `${vendor || "Vendor"} client only`;
}
