import { NextResponse } from "next/server";
import { startLogin } from "@/lib/tunnel/tailscale";
import { loadState, generateShortId } from "@/lib/tunnel/state";

export async function POST(): Promise<NextResponse> {
  try {
    const shortId = loadState()?.shortId || generateShortId();
    const result = await startLogin(shortId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Tailscale login error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
