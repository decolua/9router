// Shared by every dashboard sign-in route (password, passkey) so the
// "dashboard access via tunnel/tailscale disabled" rule cannot drift between them.

export function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export function isTunnelLoginBlocked(request, settings) {
  return Boolean(isTunnelRequest(request, settings)) && settings.tunnelDashboardAccess !== true;
}
