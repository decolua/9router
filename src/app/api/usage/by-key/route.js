import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const db = await getAdapter();

    // Build time cutoff
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else if (period === "24h") {
      cutoff = new Date(Date.now() - 86400000).toISOString();
    } else if (period === "7d") {
      cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    } else if (period === "30d") {
      cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    } else if (period === "60d") {
      cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
    }

    // Get all API keys as the base
    const allKeys = db.all(`SELECT key, name FROM apiKeys WHERE isActive = 1 ORDER BY name`);

    // Aggregate usage from usageHistory
    const usageRows = db.all(
      `SELECT apiKey, COUNT(*) as totalRequests, SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(cost) as cost, MAX(timestamp) as lastUsed FROM usageHistory WHERE timestamp >= ? AND apiKey IS NOT NULL AND apiKey != '' GROUP BY apiKey`,
      [cutoff]
    );
    const usageMap = {};
    for (const r of usageRows) usageMap[r.apiKey] = r;

    // Collect distinct providers per key
    const providerRows = db.all(
      `SELECT apiKey, provider FROM usageHistory WHERE timestamp >= ? AND apiKey IS NOT NULL AND apiKey != '' AND provider IS NOT NULL`,
      [cutoff]
    );
    const providerSets = {};
    for (const r of providerRows) {
      if (!providerSets[r.apiKey]) providerSets[r.apiKey] = new Set();
      if (r.provider) providerSets[r.apiKey].add(r.provider);
    }

    // Also include keys that have usage but aren't in apiKeys table
    const knownKeys = new Set(allKeys.map(k => k.key));
    const extraKeys = [];
    for (const r of usageRows) {
      if (!knownKeys.has(r.apiKey)) {
        extraKeys.push({ key: r.apiKey, name: null });
        knownKeys.add(r.apiKey);
      }
    }

    const keys = [...allKeys, ...extraKeys].map((k) => {
      const usage = usageMap[k.key];
      return {
        apiKey: k.key.slice(0, 8) + "...",
        name: k.name || k.key.slice(0, 8) + "...",
        totalRequests: usage?.totalRequests || 0,
        promptTokens: usage?.promptTokens || 0,
        completionTokens: usage?.completionTokens || 0,
        cost: Math.round((usage?.cost || 0) * 10000) / 10000,
        providers: providerSets[k.key] ? [...providerSets[k.key]] : [],
        lastUsed: usage?.lastUsed || null,
      };
    });

    // Sort by totalRequests descending
    keys.sort((a, b) => b.totalRequests - a.totalRequests);

    return NextResponse.json({ keys });
  } catch (error) {
    console.error("[API] Failed to get usage by key:", error);
    return NextResponse.json({ error: "Failed to fetch usage by key" }, { status: 500 });
  }
}