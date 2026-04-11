import { NextResponse } from "next/server";
import { getTunnelStatus, getTailscaleStatus } from "@/lib/tunnel/tunnelManager";

export async function GET() {
  try {
    const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
    return NextResponse.json({ tunnel, tailscale });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
