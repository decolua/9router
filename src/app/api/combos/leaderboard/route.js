import { NextResponse } from "next/server";
import { fetchLeaderboardModels, matchModelsWithLeaderboard } from "@/lib/services/artificialAnalysis";
import { buildModelsList } from "@/app/api/v1/models/route";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const minScoreParam = searchParams.get("minScore");
    const maxScoreParam = searchParams.get("maxScore");
    const limitParam = searchParams.get("limit");
    const forceRefresh = searchParams.get("refresh") === "true";

    const minScore = minScoreParam !== null && minScoreParam !== "" ? Number(minScoreParam) : null;
    const maxScore = maxScoreParam !== null && maxScoreParam !== "" ? Number(maxScoreParam) : null;
    const limit = limitParam !== null && limitParam !== "" ? Number(limitParam) : null;
    if (minScore !== null && !Number.isFinite(minScore)) {
      return NextResponse.json({ success: false, error: "Minimum intelligence score must be a number" }, { status: 400 });
    }
    if (maxScore !== null && !Number.isFinite(maxScore)) {
      return NextResponse.json({ success: false, error: "Maximum intelligence score must be a number" }, { status: 400 });
    }
    if (minScore !== null && maxScore !== null && minScore > maxScore) {
      return NextResponse.json({ success: false, error: "Minimum intelligence score cannot exceed maximum score" }, { status: 400 });
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
      return NextResponse.json({ success: false, error: "Model limit must be a whole number between 1 and 50" }, { status: 400 });
    }

    // 1. Fetch Artificial Analysis leaderboard models
    const aaModels = await fetchLeaderboardModels({ forceRefresh });

    // 2. Fetch available provider models in 9router
    let availableModels = [];
    try {
      const allModels = await buildModelsList(["llm"], { configuredOnly: true });
      // Filter out combos, keeping raw provider models and custom models
      availableModels = (allModels || []).filter((m) => m && m.owned_by !== "combo");
    } catch (modelErr) {
      console.warn("[LeaderboardAPI] Failed to get available models via buildModelsList:", modelErr.message);
    }

    // 3. Match models within score range
    const { models, details } = matchModelsWithLeaderboard({
      aaModels,
      availableModels,
      minScore,
      maxScore,
      limit,
    });

    // 4. Compute leaderboard summary
    const validScores = aaModels.map((m) => m.intelligenceIndex).filter((s) => typeof s === "number");
    const summary = {
      totalLeaderboardModels: aaModels.length,
      minScoreAvailable: validScores.length > 0 ? Math.min(...validScores) : 0,
      maxScoreAvailable: validScores.length > 0 ? Math.max(...validScores) : 0,
      matchedCount: models.length,
      availableModelsCount: availableModels.length,
    };

    return NextResponse.json({
      success: true,
      models,
      details,
      summary,
    });
  } catch (error) {
    console.error("[LeaderboardAPI] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch leaderboard models" },
      { status: 500 }
    );
  }
}
