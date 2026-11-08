import { NextResponse } from "next/server";
import { getAihotLeaderboardCatalog } from "@/lib/aihot/leaderboardScraper.js";
import { getFilterDecisions } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/aihot/leaderboard-models
 *
 * Query params:
 *   ?refresh=1 - force live scrape of https://aihot.news/leaderboard and all sub-boards
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("refresh") === "1" || searchParams.get("force") === "true";

    const catalog = await getAihotLeaderboardCatalog({ force });
    const decisions = await getFilterDecisions();

    return NextResponse.json({
      ok: true,
      count: catalog.count || 0,
      fetchedAt: catalog.fetchedAt || null,
      fromCache: catalog.fromCache || false,
      stale: Boolean(catalog.stale),
      models: catalog.models || [],
      rememberedDecisionsCount: Object.keys(decisions || {}).length,
    });
  } catch (error) {
    console.error("Error fetching aihot leaderboard catalog:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
