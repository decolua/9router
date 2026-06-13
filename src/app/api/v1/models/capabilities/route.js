import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import {
  PUBLIC_CAPABILITY_KINDS,
  buildCapabilityRegistry,
  summarizeCapabilities,
} from "@/lib/modelRegistry";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function groupModelsByKind(models) {
  return PUBLIC_CAPABILITY_KINDS.reduce((acc, kind) => {
    acc[kind] = models.filter((model) => model.kind === kind);
    return acc;
  }, {});
}

// GET /v1/models/capabilities
// Unified capability catalog for enabled provider connections.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const availableOnly = searchParams.get("available") === "true";

    const [connections, combos, customModels, modelAliases, disabledByAlias] = await Promise.all([
      getProviderConnections().catch(() => []),
      getCombos().catch(() => []),
      getCustomModels().catch(() => []),
      getModelAliases().catch(() => ({})),
      getDisabledModels().catch(() => ({})),
    ]);

    let models = buildCapabilityRegistry({
      connections,
      combos,
      customModels,
      modelAliases,
      disabledByAlias,
    });

    if (kind) {
      models = models.filter((model) => model.kind === kind);
    }
    if (availableOnly) {
      models = models.filter((model) => model.availability?.status === "available");
    }

    return Response.json({
      object: "capability_catalog",
      summary: summarizeCapabilities(models),
      data: models,
      groupedByKind: groupModelsByKind(models),
    }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.error("Error fetching model capabilities:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
