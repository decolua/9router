import { NextResponse } from "next/server";
import { disableTunnel } from "@/lib/tunnel";

export async function POST() {
  try {
    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel disable error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
