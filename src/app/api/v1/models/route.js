import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderConnections } from "@/models";

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
 * Returns models from all active providers in OpenAI format
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

    // Build set of active provider aliases
    const activeAliases = new Set();
    for (const conn of connections) {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      activeAliases.add(alias);
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // If we have active providers, only include those; otherwise include all
      if (connections.length > 0 && !activeAliases.has(alias)) {
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
