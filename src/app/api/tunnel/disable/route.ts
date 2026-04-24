import { NextResponse } from "next/server";
import { disableTunnel } from "@/lib/tunnel/tunnelManager";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Tunnel disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
