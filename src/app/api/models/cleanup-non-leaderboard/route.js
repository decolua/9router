import { NextResponse } from "next/server";
import { getCustomModels, pruneCustomModels, getFilterDecisions, setFilterDecisions } from "@/models";
import { getAihotLeaderboardCatalog } from "@/lib/aihot/leaderboardScraper.js";
import { buildLeaderboardIndex, classifyModel } from "@/lib/aihot/modelMatcher.js";

export const dynamic = "force-dynamic";

function makeCustomKey(m) {
  return `${m.providerAlias}|${m.id}|${m.type || m.kind || "llm"}`;
}

/**
 * GET /api/models/cleanup-non-leaderboard
 * Previews the cleanup of non-leaderboard models in customModels.
 */
export async function GET() {
  try {
    const catalog = await getAihotLeaderboardCatalog({ force: false });
    const index = buildLeaderboardIndex(catalog?.models || []);
    const filterDecisions = await getFilterDecisions();

    const customModels = await getCustomModels();

    const keep = [];
    const toDelete = [];
    const uncertain = [];

    for (const m of customModels) {
      if (!m?.id) continue;
      const key = makeCustomKey(m);
      const classified = classifyModel(m.id, index, filterDecisions);

      if (classified.status === "keep") {
        keep.push({
          key,
          providerAlias: m.providerAlias,
          id: m.id,
          name: m.name || m.id,
          matchedLeaderboard: classified.matchedModel?.slug || null,
          reason: classified.reason,
        });
      } else if (classified.status === "reject") {
        toDelete.push({
          key,
          providerAlias: m.providerAlias,
          id: m.id,
          name: m.name || m.id,
          reason: classified.reason,
        });
      } else {
        uncertain.push({
          key,
          providerAlias: m.providerAlias,
          id: m.id,
          name: m.name || m.id,
          candidate: classified.candidate,
          score: classified.score,
          reason: classified.reason,
        });
      }
    }

    return NextResponse.json({
      totalCustomModels: customModels.length,
      leaderboardModelCount: catalog?.count || 0,
      leaderboardFetchedAt: catalog?.fetchedAt || null,
      keepCount: keep.length,
      toDeleteCount: toDelete.length,
      uncertainCount: uncertain.length,
      keepSample: keep.slice(0, 10),
      toDeleteSample: toDelete.slice(0, 20),
      uncertainList: uncertain,
    });
  } catch (error) {
    console.error("Error previewing model cleanup:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/models/cleanup-non-leaderboard
 * Executes the cleanup, permanently removing all non-leaderboard models.
 *
 * Body (optional):
 *   {
 *     decisions?: [ { id, action: "keep" | "reject" } ] - user choices for uncertain models
 *     preserveUncertain?: boolean (default false - uncertain without decision are removed)
 *   }
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
    const preserveUncertain = Boolean(body?.preserveUncertain);

    // Save any manual decisions if provided
    if (decisions.length > 0) {
      const decisionMap = {};
      for (const d of decisions) {
        if (d?.id && (d.action === "keep" || d.action === "reject")) {
          decisionMap[d.id] = { decision: d.action, note: "User cleanup decision" };
        }
      }
      await setFilterDecisions(decisionMap);
    }

    const catalog = await getAihotLeaderboardCatalog({ force: false });
    const index = buildLeaderboardIndex(catalog?.models || []);
    const filterDecisions = await getFilterDecisions();

    const customModels = await getCustomModels();
    const keysToKeep = new Set();

    for (const m of customModels) {
      if (!m?.id) continue;
      const key = makeCustomKey(m);
      const classified = classifyModel(m.id, index, filterDecisions);

      if (classified.status === "keep") {
        keysToKeep.add(key);
      } else if (classified.status === "uncertain" && preserveUncertain) {
        keysToKeep.add(key);
      }
    }

    const deletedCount = await pruneCustomModels(keysToKeep);
    const remainingCount = keysToKeep.size;

    return NextResponse.json({
      ok: true,
      deletedCount,
      remainingCount,
      message: `已成功从总库中清理 ${deletedCount} 款非榜单模型，保留 ${remainingCount} 款顶级模型。`,
    });
  } catch (error) {
    console.error("Error executing model cleanup:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
