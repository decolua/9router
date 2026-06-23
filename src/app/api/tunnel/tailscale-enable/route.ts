import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel";

export async function POST() {
  try {
    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Tailscale enable error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
