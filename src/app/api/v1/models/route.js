import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderConnections, getCombos } from "@/lib/localDb";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list
 * Returns models from all active providers and combos in OpenAI format
 */
export async function GET() {
  try {
    // Get active provider connections
    let connections = [];
    try {
      connections = await getProviderConnections();
      // Filter to only active connections
      connections = connections.filter(c => c.isActive !== false);
    } catch (e) {
      // If database not available, return all models
      console.log("Could not fetch providers, returning all models");
    }

    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos");
    }

    // Build set of active provider aliases
    const activeAliases = new Set();
    for (const conn of connections) {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      activeAliases.add(alias);
    }

    // Resolve live Kiro catalogs (per active Kiro account) and union all the
    // expanded variants. Synthesised entries (-thinking, -agentic,
    // -thinking-agentic) overlap across accounts; dedupe by id.
    const liveKiroIds = new Map();
    for (const conn of connections) {
      if (conn.provider !== "kiro") continue;
      try {
        const result = await resolveKiroModels({
          accessToken: conn.accessToken,
          refreshToken: conn.refreshToken,
          providerSpecificData: conn.providerSpecificData || {}
        }, { log: console });
        if (!result) continue;
        for (const m of result.models) {
          if (!liveKiroIds.has(m.id)) {
            liveKiroIds.set(m.id, { id: m.id, name: m.name });
          }
        }
      } catch (err) {
        // Live fetch best-effort. Static catalog still applies.
        console.log(`Kiro live model fetch failed for connection ${conn.id}: ${err?.message || err}`);
      }
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    // Add combos first (they appear at the top)
    for (const combo of combos) {
      models.push({
        id: combo.name,
        object: "model",
        created: timestamp,
        owned_by: "combo",
        permission: [],
        root: combo.name,
        parent: null,
      });
    }

    // Add provider models
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // If we have active providers, only include those; otherwise include all
      if (connections.length > 0 && !activeAliases.has(alias)) {
        continue;
      }

      // For Kiro, prefer the live catalog when available so synthesised
      // variants (-thinking / -agentic) line up with what upstream actually
      // exposes for this account. Fall back to the static list otherwise.
      if (alias === "kr" && liveKiroIds.size > 0) {
        for (const m of liveKiroIds.values()) {
          models.push({
            id: `${alias}/${m.id}`,
            object: "model",
            created: timestamp,
            owned_by: alias,
            permission: [],
            root: m.id,
            parent: null,
          });
        }
        continue;
      }

      for (const model of providerModels) {
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          created: timestamp,
          owned_by: alias,
          permission: [],
          root: model.id,
          parent: null,
        });
      }
    }

    return Response.json({
      object: "list",
      data: models,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
