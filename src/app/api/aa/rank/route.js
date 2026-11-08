import { NextResponse } from "next/server";
import { getAihotLeaderboardCatalog, AIHOT_LEADERBOARD_BASE } from "@/lib/aihot/leaderboardScraper.js";
import { matchModels, buildIndex, topCandidates, autoBindUnmatched } from "@/lib/aa/match";
import { rankModels, RANKING_PRESETS, DEFAULT_PRESET } from "@/lib/aa/presets";
import { getRankingBindings, setRankingBindings, deleteRankingBinding, clearRankingBindings } from "@/models";

export const dynamic = "force-dynamic";

/**
 * Catalog to rank against directly from https://aihot.news/leaderboard.
 */
async function loadCatalog() {
  const catalog = (await getAihotLeaderboardCatalog({ force: false })) || { models: [], count: 0 };
  return {
    models: catalog.models || [],
    sources: [
      {
        id: "aihot",
        label: "AIHOT 大模型排行榜",
        operator: "aihot.news",
        description: "第三方评测综合评分，覆盖综合、编程、科研、专业办公、知识问答五大能力维度",
        url: AIHOT_LEADERBOARD_BASE,
        budget: 1.0,
        boards: 5,
        count: catalog.count || 0,
        implemented: true,
      },
    ],
    snapshot: {
      fetchedAt: catalog.fetchedAt,
      count: catalog.count || 0,
      stale: Boolean(catalog.stale),
    },
  };
}

/**
 * POST /api/aa/rank
 * Body: { models: string[], preset?: string, bindings?: Record<modelStr, aaSlug>,
 *         autoBind?: boolean, sources?: string[] }
 *
 * Returns the requested models ordered strongest-first under the chosen preset,
 * plus the ones the leaderboard could not be matched to. Unmatched models are
 * appended in their original order rather than dropped — the caller is ordering
 * a combo, and silently losing a tier would break its fallback chain.
 *
 * With `autoBind` (default on), a model that matched nothing is provisionally
 * bound to its closest leaderboard entry so the caller reviews a fully ordered
 * list. Those are reported in `autoBound` and marked `matchConfidence: "auto"`,
 * never presented as confirmed. In `bindings`, a key mapped to "" means the user
 * explicitly chose to leave that model unranked and is left alone.
 */
export async function POST(request) {
  try {
    const {
      models,
      preset = DEFAULT_PRESET,
      bindings = {},
      autoBind = true,
      sources = null,
    } = await request.json();

    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "models must be a non-empty array" }, { status: 400 });
    }
    if (!RANKING_PRESETS[preset]) {
      return NextResponse.json({ error: `Unknown preset: ${preset}` }, { status: 400 });
    }

    const catalog = await loadCatalog();
    if (catalog.models.length === 0) {
      return NextResponse.json(
        { error: "No leaderboard snapshot yet — sync rankings first" },
        { status: 409 }
      );
    }

    const snapshot = catalog.snapshot;
    const index = buildIndex(catalog.models);

    // Bindings the user resolved on a previous run are applied automatically, so
    // the same model does not have to be re-matched by hand every time. A binding
    // sent with THIS request is the user acting now: it wins, and is remembered.
    const storedBindings = await getRankingBindings();
    const explicitBindings = { ...bindings };
    const effectiveBindings = { ...storedBindings, ...explicitBindings };
    if (Object.keys(explicitBindings).length > 0) {
      try {
        await setRankingBindings(explicitBindings);
      } catch (error) {
        // Persisting is a convenience; a failure must not fail the ranking.
        console.log("Could not save ranking bindings:", error?.message || error);
      }
    }

    let { matched, unmatched } = matchModels(models, catalog.models, effectiveBindings);

    // Provisionally resolve the gaps, then re-match so the ordering below already
    // reflects them. Suggestions are computed here either way, so the UI can
    // offer the full shortlist next to whatever was auto-picked.
    const auto = autoBindUnmatched(unmatched, index, effectiveBindings);
    const autoBound = autoBind ? auto.bindings : {};
    if (Object.keys(autoBound).length > 0) {
      ({ matched, unmatched } = matchModels(models, catalog.models, { ...effectiveBindings, ...autoBound }));
    }

    // Rank the catalog records, then map back to the caller's model strings.
    const aaToModelStrs = new Map();
    for (const entry of matched) {
      const list = aaToModelStrs.get(entry.aa.slug) || [];
      list.push(entry);
      aaToModelStrs.set(entry.aa.slug, list);
    }

    const ranked = rankModels(matched.map((entry) => entry.aa), preset);
    const ordered = [];
    const emitted = new Set();
    for (const row of ranked) {
      for (const entry of aaToModelStrs.get(row.model.slug) || []) {
        if (emitted.has(entry.modelStr)) continue;
        emitted.add(entry.modelStr);
        ordered.push({
          model: entry.modelStr,
          aaSlug: row.model.slug,
          aaName: row.model.name,
          score: row.score,
          coverage: row.coverage,
          usedMetrics: row.usedMetrics,
          // A provisional binding must never read as a confirmed match.
          matchConfidence: autoBound[entry.modelStr] ? "auto" : entry.confidence,
          intelligenceIndex: row.model.intelligenceIndex,
          codingIndex: row.model.codingIndex,
          agenticIndex: row.model.agenticIndex,
          tau2: row.model.tau2,
          priceBlended: row.model.priceBlended,
          // Multi-source provenance: which leaderboards rated this model, how
          // much of the evidence budget that represents, and how many distinct
          // evidence families backed it. `coverage` above is the preset's metric
          // coverage — a different thing, hence the explicit name here.
          compositeScore: row.model.compositeScore,
          ability: row.model.ability,
          ratedBy: row.model.ratedBy,
          evidenceCoverage: row.model.coverage,
          evidenceFamilies: row.model.evidenceFamilies,
        });
      }
    }

    for (const modelStr of unmatched) {
      ordered.push({ model: modelStr, aaSlug: null, score: null, coverage: 0, matchConfidence: "none" });
    }

    // Shortlist for everything the leaderboard could not confirm — both the
    // still-unmatched and the auto-bound — so any guess stays correctable.
    const suggestions = { ...auto.suggestions };
    for (const modelStr of unmatched) {
      if (suggestions[modelStr]) continue;
      const candidates = topCandidates(modelStr, index);
      if (candidates.length > 0) suggestions[modelStr] = candidates;
    }

    return NextResponse.json({
      preset,
      order: ordered.map((row) => row.model),
      rows: ordered,
      unmatched,
      autoBound,
      // Everything still needing review: unresolved gaps plus provisional guesses.
      needsReview: [...Object.keys(autoBound), ...unmatched],
      suggestions,
      // What the user has already decided, so the UI can show it is remembered
      // rather than looking like it resolved the model on its own.
      remembered: effectiveBindings,
      sources: catalog.sources,
      snapshot: { fetchedAt: snapshot.fetchedAt, count: catalog.models.length, stale: snapshot.stale },
    });
  } catch (error) {
    console.log("Error ranking models:", error);
    return NextResponse.json({ error: "Failed to rank models" }, { status: 500 });
  }
}

/**
 * DELETE /api/aa/rank
 * Body: { models?: string[] } — forget these bindings, or all when omitted.
 *
 * Remembered bindings are only useful while they are correct; without a way to
 * drop one, a single bad mapping would follow the user forever.
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const models = Array.isArray(body?.models) ? body.models.filter((m) => typeof m === "string") : null;

    if (models && models.length > 0) {
      for (const model of models) await deleteRankingBinding(model);
    } else {
      await clearRankingBindings();
    }

    return NextResponse.json({ ok: true, remembered: await getRankingBindings() });
  } catch (error) {
    console.log("Error clearing ranking bindings:", error);
    return NextResponse.json({ error: "Failed to clear bindings" }, { status: 500 });
  }
}
