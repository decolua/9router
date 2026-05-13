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
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function getDateCutoff(period) {
  return new Date(Date.now() - PERIOD_MS[period]).toISOString();
}

function getDateKeyCutoff(period) {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "60d" ? 60 : 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
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

    // Aggregate per-key stats from usageDaily (byApiKey field)
    const byModel = {};
    let totalRequests = 0;
    let totalTokens = 0;
    let totalCost = 0;

    if (period === "24h") {
      // For 24h, read from usageHistory directly
      const cutoff = getDateCutoff(period);
      const rows = db.all(
        `SELECT provider, model, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND apiKey = ?`,
        [cutoff, key]
      );
      for (const r of rows) {
        const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
        const cost = r.cost || 0;
        totalRequests++;
        totalTokens += tokens;
        totalCost += cost;

        const modelKey = `${r.model || "unknown"}|${r.provider || "unknown"}`;
        if (!byModel[modelKey]) {
          byModel[modelKey] = { model: r.model || "unknown", provider: r.provider || "unknown", requests: 0, tokens: 0, cost: 0 };
        }
        byModel[modelKey].requests++;
        byModel[modelKey].tokens += tokens;
        byModel[modelKey].cost += cost;
      }
    } else {
      // For 7d/30d, read from usageDaily and parse byApiKey
      const dateKeyCutoff = getDateKeyCutoff(period);
      const dayRows = db.all(
        `SELECT data FROM usageDaily WHERE dateKey >= ?`,
        [dateKeyCutoff]
      );
      for (const dr of dayRows) {
        const day = parseJson(dr.data, {});
        const byApiKey = day.byApiKey || {};
        for (const [akKey, ak] of Object.entries(byApiKey)) {
          // akKey format: "apiKey|model|provider"
          const firstPipe = akKey.indexOf("|");
          if (firstPipe === -1) continue;
          const akKeyPart = akKey.slice(0, firstPipe);
          if (akKeyPart !== key) continue;

          const rest = akKey.slice(firstPipe + 1);
          const secondPipe = rest.indexOf("|");
          const model = secondPipe === -1 ? rest : rest.slice(0, secondPipe);
          const provider = secondPipe === -1 ? "unknown" : rest.slice(secondPipe + 1);

          const requests = ak.requests || 0;
          const tokens = (ak.promptTokens || 0) + (ak.completionTokens || 0);
          const cost = ak.cost || 0;

          totalRequests += requests;
          totalTokens += tokens;
          totalCost += cost;

          const modelKey = `${model}|${provider}`;
          if (!byModel[modelKey]) {
            byModel[modelKey] = { model, provider, requests: 0, tokens: 0, cost: 0 };
          }
          byModel[modelKey].requests += requests;
          byModel[modelKey].tokens += tokens;
          byModel[modelKey].cost += cost;
        }
      }
    }

    return NextResponse.json(
      {
        totalRequests,
        totalTokens,
        totalCost,
        byModel: Object.values(byModel).sort((a, b) => b.requests - a.requests),
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[API] public/usage GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
