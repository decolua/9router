import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/db/index.js";
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!key) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401, headers: CORS_HEADERS });
    }

    const valid = await validateApiKey(key);
    if (!valid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "24h";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400, headers: CORS_HEADERS });
    }

    const db = await getAdapter();
    const now = Date.now();

    if (period === "24h") {
      const bucketCount = 24;
      const bucketMs = 3600000;
      const startTime = now - bucketCount * bucketMs;
      const labelFn = (ts) =>
        new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

      const buckets = Array.from({ length: bucketCount }, (_, i) => ({
        label: labelFn(startTime + i * bucketMs),
        tokens: 0,
        cost: 0,
      }));

      const rows = db.all(
        `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND apiKey = ?`,
        [new Date(startTime).toISOString(), key]
      );
      for (const r of rows) {
        const t = new Date(r.timestamp).getTime();
        if (t < startTime || t > now) continue;
        const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }

      return NextResponse.json({ data: buckets }, { headers: CORS_HEADERS });
    }

    // 7d / 30d — daily buckets from usageDaily, filtered by apiKey in byApiKey
    const bucketCount = period === "7d" ? 7 : period === "60d" ? 60 : 30;
    const today = new Date();
    const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - bucketCount + 1);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

    const dayRows = db.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
    const dayMap = {};
    for (const dr of dayRows) {
      const day = parseJson(dr.data, {});
      // Sum tokens/cost for this API key across all model entries
      let tokens = 0;
      let cost = 0;
      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const firstPipe = akKey.indexOf("|");
        if (firstPipe === -1) continue;
        if (akKey.slice(0, firstPipe) !== key) continue;
        tokens += (ak.promptTokens || 0) + (ak.completionTokens || 0);
        cost += ak.cost || 0;
      }
      dayMap[dr.dateKey] = { tokens, cost };
    }

    const data = Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (bucketCount - 1 - i));
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const entry = dayMap[dateKey];
      return {
        label: labelFn(d),
        tokens: entry ? entry.tokens : 0,
        cost: entry ? entry.cost : 0,
      };
    });

    return NextResponse.json({ data }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[API] public/usage/chart GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
