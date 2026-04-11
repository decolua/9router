import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const tunnelDashboardAccess = settings.tunnelDashboardAccess === true;
    return NextResponse.json({ requireLogin, tunnelDashboardAccess });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
