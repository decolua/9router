import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

import { dashboardRole } from "@/dashboardGuard";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const headers = { "Cache-Control": "no-store" };
    if (await dashboardRole(request) !== "admin") return NextResponse.json({ requireLogin }, { headers });
    const tunnelDashboardAccess = settings.tunnelDashboardAccess !== false;
    const tunnelUrl = settings.tunnelUrl || "";
    const tailscaleUrl = settings.tailscaleUrl || "";
    return NextResponse.json({ requireLogin, tunnelDashboardAccess, tunnelUrl, tailscaleUrl }, { headers });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
