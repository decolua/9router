import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/helpers";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";

export async function POST(request) {
  try {
    await requireAdmin(request);
    const result = await enableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    if (error.message === "Admin access required" || error.message === "Authentication required") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
