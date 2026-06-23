import { PROVIDER_MODELS } from "@/shared/constants/models";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET() {
  try {
    // Collect all models from all providers
    const models: Array<{
      name: string;
      displayName: string;
      description: string;
      supportedGenerationMethods: string[];
      inputTokenLimit: number;
      outputTokenLimit: number;
    }> = [];

    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    const msg = error instanceof Error ? error.message : undefined;
    return Response.json({ error: { message: msg } }, { status: 500 });
  }
}
