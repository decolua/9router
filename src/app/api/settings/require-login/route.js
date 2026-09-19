import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const tunnelDashboardAccess = settings.tunnelDashboardAccess !== false;
    // Public allow-listed route (dashboardGuard PUBLIC_API_PATHS): never expose
    // tunnelUrl/tailscaleUrl hostnames here — the dashboard reads them from the
    // authenticated /api/settings and /api/tunnel/status routes.
    return NextResponse.json({ requireLogin, tunnelDashboardAccess });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
