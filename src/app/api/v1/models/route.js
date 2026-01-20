import { getAuthorizedModelList, getModelCorsHeaders } from "@/shared/utils/modelList";
import { getCombos } from "@/lib/localDb";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: getModelCorsHeaders() });
}

/**
 * GET /v1/models - Return models list (OpenAI compatible)
 */
export async function GET(request) {
  try {
    const models = await getAuthorizedModelList(request);
    
    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos", e);
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // Format combos
    const comboModels = combos.map(combo => ({
      id: combo.name,
      object: "model",
      created: timestamp,
      owned_by: "combo",
      permission: [],
      root: combo.name,
      parent: null,
    }));

    // Format provider models
    const providerModels = models.map((model) => ({
      id: `${model.providerAlias}/${model.id}`,
      object: "model",
      owned_by: model.provider,
      created: timestamp,
      permission: [],
      root: model.id,
      parent: null,
    }));

    return new Response(
      JSON.stringify({
        object: "list",
        data: [...comboModels, ...providerModels]
      }),
      { headers: { "Content-Type": "application/json", ...getModelCorsHeaders() } }
    );
  } catch (error) {
    const status = error.status || 500;
    const message = status === 401 ? error.message : "Failed to fetch models";
    if (status !== 401) {
      console.log("Error fetching models:", error);
    }
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { "Content-Type": "application/json", ...getModelCorsHeaders() } }
    );
  }
}
