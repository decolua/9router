/**
 * CB3 — GET /api/usage/combo-stats?range=1h|24h|7d|30d (default 24h)
 *
 * Success % per combo and failure breakdown per member, aggregated from the
 * REAL combo attribution CB2 persists (`meta.combo` + one `error:<status>`
 * line per failed attempt) — never from the model-name heuristic (D13).
 *
 * Auth: intentionally none here. /api/* is deny-by-default in
 * src/dashboardGuard.js (PROTECTED_API_PATHS covers the /api/usage prefix,
 * F38 exact-match public list does NOT list this route) — the guard owns the
 * gate, the handler must not duplicate it.
 */
import { NextResponse } from "next/server";
import { getComboStats, RANGE_MS } from "@/lib/comboStats/aggregate.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "24h";

    // Unknown range is a client error, not a silent default: a UI typo asking
    // for "5w" must not quietly render the 24h window.
    if (!Object.prototype.hasOwnProperty.call(RANGE_MS, range)) {
      return NextResponse.json(
        { error: `Invalid range "${range}" — use ${Object.keys(RANGE_MS).join("|")}` },
        { status: 400 },
      );
    }

    const payload = await getComboStats(range);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[API] Failed to compute combo stats:", error);
    return NextResponse.json({ error: "Failed to fetch combo stats" }, { status: 500 });
  }
}
