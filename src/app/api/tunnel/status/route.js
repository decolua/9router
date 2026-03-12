import { NextResponse } from "next/server";
import { getTunnelStatus } from "@/lib/tunnel/tunnelManager";

export async function GET() {
  try {
    const status = await getTunnelStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
