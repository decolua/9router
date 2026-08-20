import { NextResponse } from "next/server";
import { getConnectionDetail } from "@/lib/db/index.js";
import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import {
  monthsSince, daysSince, priceForMonth, lifetimePaidFor,
} from "@/shared/utils/subscriptionValue";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;

    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const usage = await getConnectionDetail(id);

    // Explicit allowlist rather than deleting secrets — a field added to the
    // connection record later can't leak by omission this way.
    const safeConnection = {
      id: connection.id,
      provider: connection.provider,
      authType: connection.authType,
      name: connection.name || null,
      email: connection.email || null,
      displayName: connection.displayName || null,
      isActive: connection.isActive !== false,
      priority: connection.priority ?? null,
      createdAt: connection.createdAt || null,
      testStatus: connection.testStatus || null,
      lastError: connection.lastError || null,
      monthlyCost: typeof connection.monthlyCost === "number" ? connection.monthlyCost : null,
      plan:
        connection.plan
        || connection.providerSpecificData?.plan
        || connection.providerSpecificData?.chatgptPlanType
        || null,
      proxyPoolId: connection.providerSpecificData?.proxyPoolId || null,
      region: connection.providerSpecificData?.region || null,
    };

    // Presence and expiry only — never the credential values themselves.
    const tokenStatus = {
      hasAccessToken: !!connection.accessToken,
      hasRefreshToken: !!connection.refreshToken,
      hasIdToken: !!connection.idToken,
      expiresAt: connection.expiresAt || null,
      lastRefreshAt: connection.lastRefreshAt || null,
      rateLimitedUntil: connection.rateLimitedUntil || null,
    };

    const monthlyCost = safeConnection.monthlyCost;
    const months = monthsSince(connection.createdAt);
    const days = daysSince(connection.createdAt);
    const lifetimeCost = usage?.totals?.cost || 0;
    const avgPerDay = lifetimeCost / days;

    // "Day N of an average month" — how far in before an average day's value
    // covers the month's price. Undefined for free or unpriced subs.
    let breakEvenDay = null;
    if (monthlyCost != null && monthlyCost > 0 && avgPerDay > 0) {
      breakEvenDay = Math.max(1, Math.ceil(monthlyCost / avgPerDay));
      if (breakEvenDay > 31) breakEvenDay = null;
    }

    // Attach the price actually in force for each month, rather than pricing
    // all of history at today's rate.
    const history = connection.monthlyCostHistory;
    const monthly = (usage?.monthly || []).map((m) => {
      const { amount, assumed } = priceForMonth(m.month, history, monthlyCost);
      return { ...m, paid: amount, paidAssumed: assumed };
    });

    const lifetimePaid = lifetimePaidFor(connection.createdAt, history, monthlyCost);

    const value = {
      lifetimeCost,
      monthlyCost,
      months,
      lifetimePaid,
      anyAssumedPrice: monthly.some((m) => m.paidAssumed),
      avgPerDay,
      breakEvenDay,
    };

    return NextResponse.json({
      connection: safeConnection,
      tokenStatus,
      usage: { ...usage, monthly },
      value,
    });
  } catch (error) {
    console.error("[API] Failed to get connection detail:", error);
    return NextResponse.json({ error: "Failed to fetch connection detail" }, { status: 500 });
  }
}
