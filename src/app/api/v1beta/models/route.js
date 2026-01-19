import { getAuthorizedModelList, getModelCorsHeaders } from "@/shared/utils/modelList";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: getModelCorsHeaders() });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    const models = await getAuthorizedModelList(request);

    return Response.json({
      models: models.map((model) => ({
        name: `models/${model.providerAlias}/${model.id}`,
        displayName: model.name,
        description: `${model.provider} model: ${model.name}`,
        supportedGenerationMethods: ["generateContent"],
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      }))
    });
  } catch (error) {
    const status = error.status || 500;
    const message = status === 401 ? error.message : "Failed to fetch models";
    if (status !== 401) {
      console.log("Error fetching models:", error);
    }
    return Response.json({ error: message }, { status });
  }
}
