import { NextResponse } from "next/server";
import { getAihotLeaderboardCatalog, AIHOT_LEADERBOARD_BASE } from "@/lib/aihot/leaderboardScraper.js";
import { RANKING_PRESETS, DEFAULT_PRESET } from "@/lib/aa/presets";

export const dynamic = "force-dynamic";

const PRESET_SUMMARY = Object.entries(RANKING_PRESETS).map(([key, preset]) => ({
  key,
  label: preset.label,
  description: preset.description,
  multiSource: true,
}));

/**
 * GET /api/aa/rankings - current aihot snapshot status + available presets
 * GET /api/aa/rankings?models=1[&q=text] - the leaderboard catalog for manual search/binding
 */
export async function GET(request) {
  try {
    const catalog = (await getAihotLeaderboardCatalog({ force: false })) || { models: [], count: 0 };
    const { searchParams } = new URL(request.url);

    if (searchParams.get("models")) {
      const query = (searchParams.get("q") || "").trim().toLowerCase();
      let models = (catalog.models || []).map((model) => ({
        slug: model.slug,
        name: model.name,
      }));
      if (query) {
        models = models.filter(
          (m) =>
            m.slug?.toLowerCase().includes(query) ||
            m.name?.toLowerCase().includes(query),
        );
      }
      return NextResponse.json({ models: models.slice(0, 200), total: (catalog.models || []).length });
    }

    const sources = [
      {
        id: "aihot",
        label: "AIHOT 大模型排行榜",
        operator: "aihot.news",
        description: "第三方权威评测综合评分，覆盖综合、编程、科研、专业办公、知识问答五大维度",
        url: AIHOT_LEADERBOARD_BASE,
        budget: 1.0,
        boards: 5,
        count: catalog.count || 0,
        implemented: true,
        fetchedAt: catalog.fetchedAt,
      },
    ];

    return NextResponse.json({
      fetchedAt: catalog.fetchedAt,
      count: catalog.count || 0,
      stale: Boolean(catalog.stale),
      source: AIHOT_LEADERBOARD_BASE,
      sources,
      needsResync: false,
      presets: PRESET_SUMMARY,
      defaultPreset: DEFAULT_PRESET,
    });
  } catch (error) {
    console.log("Error reading aihot rankings:", error);
    return NextResponse.json({ error: "Failed to read rankings" }, { status: 500 });
  }
}

/**
 * POST /api/aa/rankings - re-sync fresh rankings directly from aihot.news
 */
export async function POST() {
  try {
    const catalog = await getAihotLeaderboardCatalog({ force: true });
    const ok = catalog.count > 0;
    return NextResponse.json({
      ok,
      count: catalog.count,
      results: [
        {
          id: "aihot",
          label: "AIHOT 大模型排行榜",
          ok,
          count: catalog.count,
        },
      ],
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Sync failed" }, { status: 500 });
  }
}
