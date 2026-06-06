import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { getRemoteExposureBlockReason } from "@/lib/security/exposureGate";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const settings = await getSettings();
    const blockReason = getRemoteExposureBlockReason(settings);
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 400 });
    }

    const result = await enableTunnel();
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
