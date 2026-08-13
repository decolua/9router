import { NextResponse } from "next/server";
import { getConnectionValue } from "@/lib/db/index.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86400000;

/**
 * Whole months elapsed since a connection was created, floored at 1.
 *
 * A sub billed monthly has been paid for at least once the moment it exists,
 * so a 3-day-old account is "1 month paid", not 0.1 — the alternative divides
 * by a fraction and reports an absurdly inflated multiple in week one.
 */
function monthsSince(createdAt) {
  if (!createdAt) return 1;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return 1;
  const days = (Date.now() - start.getTime()) / MS_PER_DAY;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.max(1, Math.floor(days / 30.44) + 1);
}

export async function GET() {
  try {
    const [valueByConnection, connections] = await Promise.all([
      getConnectionValue(),
      getProviderConnections().catch(() => []),
    ]);

    const result = {};
    for (const conn of connections) {
      // API-key connections pay list price, so value/paid is always 1x —
      // the badge is meaningless there and the UI hides it.
      if (conn.authType !== "oauth") continue;

      const usage = valueByConnection[conn.id] || {
        lifetimeCost: 0, monthCost: 0, lifetimeRequests: 0, monthRequests: 0,
      };
      const monthlyCost = typeof conn.monthlyCost === "number" ? conn.monthlyCost : null;
      const months = monthsSince(conn.createdAt);

      result[conn.id] = {
        lifetimeCost: usage.lifetimeCost,
        monthCost: usage.monthCost,
        lifetimeRequests: usage.lifetimeRequests,
        monthRequests: usage.monthRequests,
        monthlyCost,
        months,
        lifetimePaid: monthlyCost == null ? null : monthlyCost * months,
      };
    }

    return NextResponse.json({ connections: result });
  } catch (error) {
    console.error("[API] Failed to get connection value:", error);
    return NextResponse.json({ error: "Failed to fetch connection value" }, { status: 500 });
  }
}
