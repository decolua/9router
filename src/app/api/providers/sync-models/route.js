import { NextResponse } from "next/server";
import { getProviderConnections, getCustomModels, addCustomModel, getFilterDecisions } from "@/models";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { fetchModelsForConnection, supportsModelListing } from "@/lib/providerModels/fetchModels";
import { partitionChatModels, modelIdOf } from "@/lib/providerModels/classify";
import { getAihotLeaderboardCatalog, readCachedLeaderboardModels } from "@/lib/aihot/leaderboardScraper.js";
import { buildLeaderboardIndex, classifyModel } from "@/lib/aihot/modelMatcher.js";

export const dynamic = "force-dynamic";
// One live catalog fetch per provider; a wide selection needs room.
export const maxDuration = 300;

/**
 * Where a provider's models are stored. Compatible nodes key on the node id
 * (each node is its own provider), built-ins key on the registry alias — the
 * same rule the provider detail page uses, so both write to one place.
 */
function storageAliasFor(providerId) {
  const isCompatible =
    isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  return isCompatible ? providerId : getProviderAlias(providerId);
}

/** Ids already known for this provider: static registry + previously added custom. */
function knownIdsFor(providerId, alias, customModels) {
  const known = new Set();
  try {
    for (const model of getModelsByProviderId(providerId) || []) {
      const id = model?.id;
      if (id) known.add(String(id));
    }
  } catch {
    // A provider with no static catalog is normal (compatible nodes).
  }
  for (const entry of customModels || []) {
    if (entry?.providerAlias === alias && entry?.id) known.add(String(entry.id));
  }
  return known;
}

/**
 * Refresh one provider's model list from its live catalog.
 * Never throws — a provider that fails must not abort the rest of the batch.
 */
async function syncProvider(providerId, connections, customModels, options = {}) {
  const { filterByLeaderboard = true, leaderboardIndex = null, filterDecisions = {} } = options;
  const base = {
    provider: providerId,
    added: 0,
    alreadyKnown: 0,
    skippedNonChat: 0,
    skippedFiltered: 0,
    newModels: [],
    pendingReview: [],
  };

  if (!supportsModelListing(providerId)) {
    return { ...base, ok: false, error: "Provider does not support live model listing" };
  }

  const active = connections.filter(
    (c) => c.provider === providerId && c.isActive !== false,
  );
  if (active.length === 0) {
    return { ...base, ok: false, error: "No active connection" };
  }

  // Try each connection in turn: one account can be expired or rate-limited
  // while another on the same provider still answers.
  let lastError = "No active connection";
  for (const connection of active) {
    let result;
    try {
      result = await fetchModelsForConnection(connection);
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 200);
      continue;
    }
    if (result?.error) {
      lastError = result.error;
      continue;
    }

    const { chat, other } = partitionChatModels(result.models || []);
    const alias = storageAliasFor(providerId);
    const known = knownIdsFor(providerId, alias, customModels);

    const report = {
      ...base,
      ok: true,
      connectionId: connection.id,
      total: (result.models || []).length,
      skippedNonChat: other.length,
      skippedFiltered: 0,
      pendingReview: [],
      ...(result.warning ? { warning: result.warning } : {}),
    };

    for (const model of chat) {
      // Some providers return already-prefixed ids (e.g. "qoder/auto"); store
      // the bare id so it resolves as "<alias>/<id>" like every other model.
      const rawId = String(modelIdOf(model));
      const id = rawId.startsWith(`${providerId}/`) ? rawId.slice(providerId.length + 1) : rawId;
      if (!id || known.has(id)) {
        report.alreadyKnown += 1;
        continue;
      }

      const modelDisplayName =
        (typeof model === "object" && (model.name || model.display_name)) || id;

      // Filter against aihot.news leaderboard catalog if enabled
      if (filterByLeaderboard && leaderboardIndex) {
        const classified = classifyModel(id, leaderboardIndex, filterDecisions);

        if (classified.status === "reject") {
          report.skippedFiltered += 1;
          continue;
        }

        if (classified.status === "uncertain") {
          report.pendingReview.push({
            provider: providerId,
            providerAlias: alias,
            id,
            name: modelDisplayName,
            candidate: classified.candidate,
            score: Math.round(classified.score * 100) / 100,
            reason: classified.reason,
          });
          continue;
        }
      }

      try {
        await addCustomModel({
          providerAlias: alias,
          id,
          type: "llm",
          name: modelDisplayName,
        });
        known.add(id);
        report.added += 1;
        report.newModels.push(id);
      } catch (error) {
        // Keep going: one bad id must not stop the provider's remaining models.
        console.log(`sync-models: failed to add ${alias}/${id}:`, error?.message || error);
      }
    }

    return report;
  }

  return { ...base, ok: false, error: lastError };
}

/**
 * GET /api/providers/sync-models
 *
 * The providers that can actually be refreshed: those with at least one
 * connection AND a live catalog endpoint (explicit config, registry
 * `modelsFetcher`, or a derivable base URL). Computed here rather than in the
 * dashboard so the picker can't drift from the provider registry.
 */
export async function GET() {
  try {
    const connections = await getProviderConnections();

    const byProvider = new Map();
    for (const connection of connections) {
      const providerId = connection?.provider;
      if (!providerId) continue;
      if (!byProvider.has(providerId)) {
        byProvider.set(providerId, { provider: providerId, connections: 0, activeConnections: 0 });
      }
      const entry = byProvider.get(providerId);
      entry.connections += 1;
      if (connection.isActive !== false) entry.activeConnections += 1;
    }

    const providers = [...byProvider.values()]
      .map((entry) => ({
        ...entry,
        alias: storageAliasFor(entry.provider),
        isCustom:
          isOpenAICompatibleProvider(entry.provider) || isAnthropicCompatibleProvider(entry.provider),
        supported: supportsModelListing(entry.provider),
      }))
      // Keep providers that merely have no ACTIVE connection: a provider the
      // user just added lands here before its key is enabled, and hiding it made
      // the list look like it had not picked the provider up at all. The row
      // shows the active count and the sync reports the real reason.
      .filter((entry) => entry.supported && entry.connections > 0)
      .sort((a, b) => a.provider.localeCompare(b.provider));

    const cachedLeaderboard = readCachedLeaderboardModels();
    const decisions = await getFilterDecisions();

    return NextResponse.json({
      providers,
      leaderboard: {
        count: cachedLeaderboard?.count || 0,
        fetchedAt: cachedLeaderboard?.fetchedAt || null,
      },
      rememberedDecisionsCount: Object.keys(decisions || {}).length,
    });
  } catch (error) {
    console.log("Error listing syncable providers:", error);
    return NextResponse.json(
      { error: String(error?.message || error).slice(0, 240) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/providers/sync-models
 *
 * Body: {
 *   providers: ["openai", "groq", "openai-compatible-abc"],
 *   filterByLeaderboard?: boolean (default true),
 *   forceRefreshLeaderboard?: boolean (default true)
 * }
 *
 * Refreshes each selected provider's model list from its live catalog and
 * registers anything new. When filterByLeaderboard is true, it refreshes the
 * aihot.news leaderboard catalog first and filters out models not present on the
 * leaderboard or remembered as rejected. Models with ambiguous names are
 * returned in pendingReview for user confirmation.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const providers = Array.isArray(body?.providers)
      ? [...new Set(body.providers.filter((p) => typeof p === "string" && p.trim()))]
      : [];

    if (providers.length === 0) {
      return NextResponse.json({ error: "providers array is required" }, { status: 400 });
    }

    const filterByLeaderboard = body?.filterByLeaderboard !== false;
    let leaderboardIndex = null;
    let leaderboardCatalog = null;
    let filterDecisions = {};

    if (filterByLeaderboard) {
      try {
        leaderboardCatalog = await getAihotLeaderboardCatalog({
          force: body?.forceRefreshLeaderboard !== false,
        });
        leaderboardIndex = buildLeaderboardIndex(leaderboardCatalog?.models || []);
        filterDecisions = await getFilterDecisions();
      } catch (err) {
        console.warn("[sync-models] failed to prepare leaderboard index:", err.message);
      }
    }

    const connections = await getProviderConnections();
    // Read once: addCustomModel writes go to the same store, and re-reading per
    // provider would only add IO without changing the per-provider dedup, which
    // is tracked in-memory as we add.
    const customModels = await getCustomModels();

    const results = [];
    for (const providerId of providers) {
      results.push(
        await syncProvider(providerId, connections, customModels, {
          filterByLeaderboard,
          leaderboardIndex,
          filterDecisions,
        }),
      );
    }

    const allPendingReview = results.flatMap((r) => r.pendingReview || []);

    const summary = {
      providers: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      added: results.reduce((sum, r) => sum + (r.added || 0), 0),
      skippedFiltered: results.reduce((sum, r) => sum + (r.skippedFiltered || 0), 0),
      pendingReviewCount: allPendingReview.length,
    };

    return NextResponse.json({
      results,
      summary,
      pendingReview: allPendingReview,
      leaderboard: leaderboardCatalog
        ? {
            count: leaderboardCatalog.count || 0,
            fetchedAt: leaderboardCatalog.fetchedAt || null,
            fromCache: Boolean(leaderboardCatalog.fromCache),
          }
        : null,
    });
  } catch (error) {
    console.log("Error syncing provider models:", error);
    return NextResponse.json(
      { error: String(error?.message || error).slice(0, 240) },
      { status: 500 },
    );
  }
}
