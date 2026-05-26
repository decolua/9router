import { NextResponse } from "next/server";
import { importProviderConfig } from "@/lib/localDb";
import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

export async function POST(request) {
  try {
    const payload = await request.json();
    const result = await importProviderConfig(payload);

    // Re-apply proxy settings after import
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[ProviderImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true, providerConfig: result });
  } catch (error) {
    console.log("Error importing provider config:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import provider config" },
      { status: 400 }
    );
  }
}
