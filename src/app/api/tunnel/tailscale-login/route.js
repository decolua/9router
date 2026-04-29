import { NextResponse } from "next/server";
import { startLogin } from "@/lib/tunnel/tailscale";
import { loadState, generateShortId } from "@/lib/tunnel/state.js";

export async function POST() {
  try {
    const shortId = loadState()?.shortId || generateShortId();
    const result = await startLogin(shortId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale login error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
