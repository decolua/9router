import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import { getUsageHistory } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);
const PERIOD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
};

export const dynamic = "force-dynamic";

function getPeriodRange(period) {
  const now = new Date();
  if (period === "all") {
    return { startDate: null, endDate: now };
  }

  if (period === "today") {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate: now };
  }

  const ms = PERIOD_MS[period];
  if (ms) {
    return { startDate: new Date(now.getTime() - ms), endDate: now };
  }

  return { startDate: null, endDate: now };
}

function formatModelKey(model, provider) {
  const normalizedModel = model || "unknown";
  const normalizedProvider = provider || "unknown";
  return `${normalizedModel} (${normalizedProvider})`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const { startDate, endDate } = getPeriodRange(period);
    const rows = await getUsageHistory({
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate.toISOString(),
      apiKey: key.key,
    });

    let totalRequests = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCost = 0;
    let lastUsed = null;
    const modelMap = {};

    for (const row of rows) {
      totalRequests += 1;
      const promptTokens = toNumber(row.promptTokens);
      const completionTokens = toNumber(row.completionTokens);
      const rowCost = toNumber(row.cost);

      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;
      totalCost += rowCost;

      if (row.timestamp && (!lastUsed || row.timestamp > lastUsed)) {
        lastUsed = row.timestamp;
      }

      const modelKey = formatModelKey(row.model, row.provider);
      if (!modelMap[modelKey]) {
        modelMap[modelKey] = {
          model: row.model || "unknown",
          provider: row.provider || "unknown",
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          lastUsed: null,
        };
      }
      const agg = modelMap[modelKey];
      agg.requests += 1;
      agg.promptTokens += promptTokens;
      agg.completionTokens += completionTokens;
      agg.cost += rowCost;
      if (row.timestamp && (!agg.lastUsed || row.timestamp > agg.lastUsed)) {
        agg.lastUsed = row.timestamp;
      }
    }

    const topModels = Object.values(modelMap)
      .map((m) => ({
        ...m,
        totalTokens: m.promptTokens + m.completionTokens,
      }))
      .sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens)
      .slice(0, 5);

    return NextResponse.json({
      key: {
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
      },
      period,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate.toISOString(),
      summary: {
        requests: totalRequests,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        cost: totalCost,
        lastUsed,
      },
      topModels,
    });
  } catch (error) {
    console.error("[API] Failed to get usage for API key:", error);
    return NextResponse.json({ error: "Failed to fetch API key usage" }, { status: 500 });
  }
}
