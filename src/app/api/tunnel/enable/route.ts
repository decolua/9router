import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const result = await enableTunnel();
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, DNS_WARMUP_DELAY_MS);
    await promise;
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
