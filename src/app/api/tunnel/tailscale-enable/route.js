import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel/tunnelManager";

export async function POST() {
  try {
    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
