import { getAuthorizedModelList, getModelCorsHeaders } from "@/shared/utils/modelList";

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

    return new Response(
      JSON.stringify({
        object: "list",
        data: models.map((model) => ({
          id: `${model.providerAlias}/${model.id}`,
          object: "model",
          owned_by: model.provider,
        }))
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
