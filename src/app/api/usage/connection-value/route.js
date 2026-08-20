import { NextResponse } from "next/server";
import { getConnectionValue } from "@/lib/db/index.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { monthsSince, lifetimePaidFor } from "@/shared/utils/subscriptionValue";

export const dynamic = "force-dynamic";

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
      // History-aware, matching the detail page — pricing every month at the
      // current rate makes the badge disagree with the page after a plan change.
      const lifetimePaid = lifetimePaidFor(conn.createdAt, conn.monthlyCostHistory, monthlyCost);

      result[conn.id] = {
        lifetimeCost: usage.lifetimeCost,
        monthCost: usage.monthCost,
        lifetimeRequests: usage.lifetimeRequests,
        monthRequests: usage.monthRequests,
        monthlyCost,
        months,
        lifetimePaid,
      };
    }

    return NextResponse.json({ connections: result });
  } catch (error) {
    console.error("[API] Failed to get connection value:", error);
    return NextResponse.json({ error: "Failed to fetch connection value" }, { status: 500 });
  }
}
