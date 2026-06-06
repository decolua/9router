import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/localDb";
import { getRemoteExposureBlockReason } from "@/lib/security/exposureGate";

export async function POST() {
  try {
    const settings = await getSettings();
    const blockReason = getRemoteExposureBlockReason(settings);
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 400 });
    }

    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
