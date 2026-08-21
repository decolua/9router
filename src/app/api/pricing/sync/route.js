import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { PRICING_SOURCE_URL, syncPricingFromOpenCode } from "@/shared/services/pricingSync";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    source: PRICING_SOURCE_URL,
    enabled: !!settings.pricingAutoSyncEnabled,
    intervalHours: settings.pricingAutoSyncIntervalHours,
    lastSyncAt: settings.pricingLastSyncAt,
    status: settings.pricingLastSyncStatus,
    error: settings.pricingLastSyncError,
  });
}

export async function POST() {
  try {
    return NextResponse.json(await syncPricingFromOpenCode());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
