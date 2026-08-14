import { NextResponse } from "next/server";
import { getConnectionDetail } from "@/lib/db/index.js";
import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86400000;

/**
 * Whole months elapsed since the connection was created, floored at 1 — a sub
 * billed monthly has been paid for at least once the moment it exists.
 */
function monthsSince(createdAt) {
  if (!createdAt) return 1;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return 1;
  const days = (Date.now() - start.getTime()) / MS_PER_DAY;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.max(1, Math.floor(days / 30.44) + 1);
}

function daysSince(createdAt) {
  if (!createdAt) return 1;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return 1;
  return Math.max(1, Math.round((Date.now() - start.getTime()) / MS_PER_DAY));
}

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

    const value = {
      lifetimeCost,
      monthlyCost,
      months,
      lifetimePaid: monthlyCost == null ? null : monthlyCost * months,
      avgPerDay,
      breakEvenDay,
    };

    return NextResponse.json({ connection: safeConnection, tokenStatus, usage, value });
  } catch (error) {
    console.error("[API] Failed to get connection detail:", error);
    return NextResponse.json({ error: "Failed to fetch connection detail" }, { status: 500 });
  }
}
