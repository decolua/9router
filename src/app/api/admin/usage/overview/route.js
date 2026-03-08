import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getUsers, getApiKeys } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period, null);

    let users = [];
    let apiKeyCountByUser = {};
    try {
      users = await getUsers();
      const keys = await getApiKeys();
      for (const k of keys) {
        const uid = k.userId ?? k.user_id ?? null;
        if (uid) apiKeyCountByUser[uid] = (apiKeyCountByUser[uid] ?? 0) + 1;
      }
    } catch (e) {
      console.warn("[Admin usage overview] Could not load users/api keys:", e.message);
    }

    const byUser = stats.byUser ?? {};
    const usersSummary = users.map((u) => {
      const uid = u.id;
      const usage = byUser[uid] ?? { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
      return {
        userId: uid,
        email: u.email,
        displayName: u.displayName,
        requests: usage.requests,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cost: usage.cost,
        apiKeyCount: apiKeyCountByUser[uid] ?? 0,
      };
    });

    return NextResponse.json({ ...stats, usersSummary });
  } catch (error) {
    console.error("[API] Failed to get admin usage overview:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch usage overview" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
