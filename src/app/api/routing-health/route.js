import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getAllHealthStats, resetHealthStats } from "open-sse/services/healthTracker.js";
import { resolveHealthConfig, LATENCY_AWARE_STRATEGY } from "open-sse/config/healthConfig.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const settings = await getSettings();
    const config = resolveHealthConfig(settings.latencyAwareConfig);
    const rows = getAllHealthStats(config);

    const providerStrategies = settings.providerStrategies || {};
    const perProviderEnabled = Object.entries(providerStrategies)
      .filter(([, v]) => v?.fallbackStrategy === LATENCY_AWARE_STRATEGY)
      .map(([providerId]) => providerId);

    return NextResponse.json(
      {
        globalStrategy: settings.fallbackStrategy || "fill-first",
        latencyAwareActive: settings.fallbackStrategy === LATENCY_AWARE_STRATEGY,
        perProviderEnabled,
        config,
        stats: rows,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    resetHealthStats(connectionId || null);
    return NextResponse.json({ ok: true, cleared: connectionId || "all" }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
