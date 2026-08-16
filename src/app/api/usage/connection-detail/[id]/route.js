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

/**
 * Price in force during a given month ("2026-08"), from the recorded change
 * log. Months before the first recorded change are marked `assumed`, because
 * the price then is genuinely unknown — the log only starts when the user
 * first sets a price, and pretending otherwise is what made the old
 * month-by-month numbers wrong after a plan change.
 */
function priceForMonth(monthKey, history, currentCost) {
  if (!Array.isArray(history) || history.length === 0) {
    return { amount: currentCost, assumed: currentCost != null };
  }

  const sorted = [...history]
    .filter((h) => h && typeof h.effectiveFrom === "string")
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  if (sorted.length === 0) return { amount: currentCost, assumed: currentCost != null };

  // Compare at the month's end, so a price set mid-month applies to that month.
  const monthEnd = `${monthKey}-31`;
  let applicable = null;
  for (const entry of sorted) {
    if (entry.effectiveFrom.slice(0, 10) <= monthEnd) applicable = entry;
    else break;
  }

  if (!applicable) {
    // Earlier than any recorded price — fall back to the oldest known one.
    return { amount: sorted[0].amount, assumed: true };
  }
  return { amount: applicable.amount, assumed: false };
}

/** Every month key ("2026-08") from the connection's creation through today. */
function monthKeysSince(createdAt) {
  const now = new Date();
  const start = createdAt ? new Date(createdAt) : now;
  const from = Number.isNaN(start.getTime()) ? now : start;

  const keys = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  // Guard against a bogus future createdAt producing an empty span.
  if (cursor > end) return [`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`];

  while (cursor <= end) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
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

    // Attach the price actually in force for each month, rather than pricing
    // all of history at today's rate.
    const history = connection.monthlyCostHistory;
    const monthly = (usage?.monthly || []).map((m) => {
      const { amount, assumed } = priceForMonth(m.month, history, monthlyCost);
      return { ...m, paid: amount, paidAssumed: assumed };
    });

    // Lifetime paid spans every month the sub was *held*, not just the months
    // it was used — you pay for idle months too, and counting only active ones
    // would understate the cost and inflate the return.
    const heldMonths = monthKeysSince(connection.createdAt);
    const pricedHeldMonths = heldMonths
      .map((mk) => priceForMonth(mk, history, monthlyCost).amount)
      .filter((amount) => typeof amount === "number");
    const lifetimePaid = pricedHeldMonths.length === 0
      ? null
      : pricedHeldMonths.reduce((sum, amount) => sum + amount, 0);

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
