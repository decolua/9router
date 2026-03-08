import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/helpers";
import { disableTunnel } from "@/lib/tunnel/tunnelManager";

export async function POST(request) {
  try {
    await requireAdmin(request);
    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    if (error.message === "Admin access required" || error.message === "Authentication required") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Tunnel disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
